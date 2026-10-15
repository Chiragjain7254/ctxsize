import path from 'node:path';
import vm from 'node:vm';
import { expect, test, vi } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { AGENT_IDS } from '../src/core/types.ts';
import { buildPageData, type PageData, pageScript, renderHtml } from '../src/report/html.ts';
import { tmpRepo } from './helpers.ts';

// The first test in this file loads the tokenizer and the page builder, which takes seconds on a
// slow or busy machine. The work is slow, not stuck, so the file gets a longer timeout.
vi.setConfig({ testTimeout: 30_000 });

const KiB = 1024;

async function report(
  files: Record<string, string>,
  sub = '',
  agents: readonly string[] = AGENT_IDS,
) {
  const root = tmpRepo({ '.git/': '', ...files });
  return analyze({ cwd: path.join(root, sub), agents: [...agents] });
}
async function html(files: Record<string, string>, sub = '') {
  return renderHtml(await report(files, sub));
}

function dataOf(out: string): PageData {
  const m = /<script type="application\/json" id="ctxsize-data">(.*?)<\/script>/s.exec(out);
  return JSON.parse(m?.[1] ?? 'null');
}

/**
 * Runs the page script against a tiny fake DOM that records what is assigned to each element,
 * so the markup the page would render can be checked without a browser.
 */
function runPage(out: string) {
  const data = /id="ctxsize-data">(.*?)<\/script>/s.exec(out)?.[1] ?? '{}';
  const props = new Map<string, Record<string, unknown>>();
  const stub = (): unknown =>
    new Proxy(function stubTarget() {}, {
      get: (_t, k) => {
        if (k === Symbol.iterator) return function* empty() {};
        if (k === Symbol.toPrimitive) return () => '';
        if (k === 'length') return 0;
        return stub();
      },
      apply: () => stub(),
      set: () => true,
    });
  const element = (id: string) => {
    const own: Record<string, unknown> = id === 'ctxsize-data' ? { textContent: data } : {};
    props.set(id, own);
    return new Proxy(function elementTarget() {}, {
      get: (_t, k) => (typeof k === 'string' && k in own ? own[k] : stub()),
      set: (_t, k, v) => {
        own[String(k)] = v;
        return true;
      },
      apply: () => stub(),
    });
  };
  const elements = new Map<string, unknown>();
  const document = {
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    documentElement: stub(),
    head: stub(),
    activeElement: null,
    addEventListener: () => {},
    querySelector: () => null,
    createElement: () => stub(),
  };
  const window = {
    localStorage: {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    },
    matchMedia: () => ({ matches: false }),
    setInterval: () => 0,
    innerWidth: 1000,
    innerHeight: 800,
  };
  vm.runInNewContext(pageScript(), { document, window, JSON, Date, Math, Number, String });
  return (id: string) => String(props.get(id)?.innerHTML ?? '');
}

test('is self-contained: no external URLs or fetches', async () => {
  const out = await html({ 'AGENTS.md': 'See https://example.com for docs.\n' });
  expect(out).not.toMatch(/\s(src|href)=["']?https?:/i);
  expect(out).not.toMatch(/fetch\(|XMLHttpRequest|@import url|https?:\/\//);
  expect(out).not.toMatch(/\ssrc=/);
  expect(out).not.toContain('example.com'); // file contents are never embedded
});

test('escapes file names so markup in them is inert', async () => {
  // Windows forbids < and > in file names, so the name is set on the report directly.
  const r = await report({ 'AGENTS.md': 'x\n' }, '', ['codex']);
  const item = r.agents[0]?.items[0];
  if (item) item.path = '<script>alert(1)</script>.md';
  const out = renderHtml(r);
  expect(out).not.toContain('<script>alert(1)');
  expect(out).toContain('\\u003cscript>alert(1)');
  // And the page escapes it again when it builds markup.
  const panel = runPage(out)('panel');
  expect(panel).toContain('&#60;script&#62;');
  expect(panel).not.toContain('<script>');
});

test('embeds per-item counts for both tokenizers and the character count', async () => {
  const text = 'Use npm, not yarn. Run the tests.\n';
  const data = dataOf(await html({ 'AGENTS.md': text }));
  const item = data.agents.find((a) => a.id === 'codex')?.items[0];
  expect(item?.chars).toBe([...text].length);
  expect(item?.o).toBeGreaterThan(0);
  expect(item?.c).toBeGreaterThan(0);
  expect(JSON.stringify(data)).not.toContain('Run the tests');
  expect(data.models.map((m) => m.id)).toContain('claude-sonnet-5-5');
  expect(data.models.find((m) => m.id === 'qwen3.8-max')?.tok).toBe('ratio');
  expect(data.watch).toBeNull();
});

test('the page shows one tab per agent, the first selected, and a comparison row each', async () => {
  const out = await html({ 'AGENTS.md': 'Use npm.\n' });
  const run = runPage(out);
  const tabs = run('tabs');
  expect(tabs.match(/role="tab"/g)).toHaveLength(dataOf(out).agents.length);
  expect(tabs.match(/aria-selected="true"/g)).toHaveLength(1);
  expect(run('compare').match(/<tr class/g)).toHaveLength(dataOf(out).agents.length);
  expect(run('tools').match(/<li /g)).toHaveLength(dataOf(out).agents.length);
});

test('dropped and cut files are drawn hatched with a legend entry', async () => {
  const r = await report(
    {
      'AGENTS.md': `${'Root rule text. '.repeat(1400)}\n`,
      'pkg/AGENTS.md': `${'Package rule. '.repeat(1400)}\n`,
    },
    'pkg',
    ['codex'],
  );
  const out = renderHtml(r);
  const data = dataOf(out);
  const codex = data.agents.find((a) => a.id === 'codex');
  expect(codex?.cuts.length).toBeGreaterThan(0);
  const run = runPage(out);
  const panel = run('panel');
  expect(panel).toContain('class="tile cat-instructions lost"');
  expect(panel).toContain('Dropped or cut off');
  expect(panel).toContain('(cut part)');
});

test('an empty repo says so instead of drawing an empty map', async () => {
  expect(runPage(await html({}))('panel')).toContain('Nothing from this repo loads at startup');
});

test('watch mode embeds the data file name and polling interval', async () => {
  const r = await report({ 'AGENTS.md': 'x\n' }, '', ['codex']);
  const out = renderHtml(r, { watch: { file: 'r.data.js' }, generated: '1' });
  expect(dataOf(out).watch).toEqual({ file: 'r.data.js', every: 2000 });
  expect(out).not.toMatch(/https?:\/\//);
});

test('stays small for a typical repo', async () => {
  const files: Record<string, string> = { 'AGENTS.md': 'x\n'.repeat(500) };
  for (let i = 0; i < 60; i++) {
    files[`.claude/skills/s${i}/SKILL.md`] = `---\ndescription: Skill ${i}\n---\n`;
  }
  expect(Buffer.byteLength(await html(files))).toBeLessThan(250 * KiB);
});

test('buildPageData keeps a model the report used even when it is not offered', async () => {
  const r = await report({ 'AGENTS.md': 'x\n' }, '', ['codex']);
  const data = buildPageData(r, { models: new Map() });
  expect(data.models.map((m) => m.id)).toEqual([r.agents[0]?.model.id]);
});
