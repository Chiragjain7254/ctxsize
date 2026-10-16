import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { AGENT_IDS } from '../src/core/types.ts';
import { GLOSSARY, glossaryMarkdown, helpIcon } from '../src/report/glossary.ts';
import { pageScript, renderHtml } from '../src/report/html.ts';
import { tmpRepo } from './helpers.ts';

vi.setConfig({ testTimeout: 30_000 });

const root = path.join(import.meta.dirname, '..');

// The words a first-time reader asked about.
const REQUIRED = [
  'startup',
  'ondemand',
  'pct',
  'window',
  'overhead',
  'cost',
  'model',
  'messages',
  'price',
  'instructions',
  'rules',
  'skills',
  'loads',
  'why',
  'dropped',
  'legacy',
  'oversize',
  'checks',
  'mcp',
  'estimate',
  'default',
  'risk',
  'tip',
  'ok',
];

test('every term a beginner needs has a definition with an example', () => {
  const ids = GLOSSARY.map((e) => e.id);
  for (const id of REQUIRED) expect(ids, id).toContain(id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const e of GLOSSARY) {
    expect(e.text.length, e.id).toBeGreaterThan(20);
    expect(e.text.length, `${e.id} is too long for a tooltip`).toBeLessThan(260);
    expect(
      e.text.split(/[.!?] /).length,
      `${e.id} should be one or two sentences`,
    ).toBeLessThanOrEqual(2);
    expect(e.example.length, e.id).toBeGreaterThan(5);
  }
});

test('docs/GLOSSARY.md is generated from the same text (run npm run docs:glossary)', () => {
  const file = readFileSync(path.join(root, 'docs', 'GLOSSARY.md'), 'utf8').replace(/\r\n/g, '\n');
  expect(file).toBe(glossaryMarkdown());
});

test('a help icon points at text that exists, for keyboard and screen readers', () => {
  const html = helpIcon('startup');
  expect(html).toContain('<button type="button"');
  expect(html).toContain('aria-describedby="hd-startup"');
  expect(html).toContain('aria-labelledby="ht-startup"');
});

async function page() {
  const dir = tmpRepo({
    '.git/': '',
    'AGENTS.md': 'Use npm.\n',
    '.claude/skills/nodesc/SKILL.md': '---\nname: nodesc\n---\nBody\n',
  });
  return renderHtml(await analyze({ cwd: dir, agents: [...AGENT_IDS] }));
}

test('the page carries every definition once, plus a collapsible glossary with the same text', async () => {
  const out = await page();
  for (const e of GLOSSARY) {
    expect(out, e.id).toContain(`id="hd-${e.id}"`);
    expect(out, e.id).toContain(
      e.text.replace(/&/g, '&#38;').replace(/'/g, '&#39;').replace(/"/g, '&#34;'),
    );
  }
  expect(out).toContain('<h3>What do these words mean?</h3>');
  expect(out).toContain('<div id="glossary">');
  expect(out).not.toMatch(/https?:\/\//);
});

test('every help icon in the page markup has a definition to describe it', async () => {
  const out = await page();
  const used = [...out.matchAll(/data-help="([a-z-]+)"/g)].map((m) => m[1]);
  expect(used.length).toBeGreaterThan(8);
  for (const id of used)
    expect(
      GLOSSARY.map((e) => e.id),
      id,
    ).toContain(id);
});

test('the page script shows the help on hover, focus and tap, and closes it on Escape', () => {
  const script = pageScript();
  for (const piece of ['pointerover', 'focusin', 'focusout', 'Escape']) {
    expect(script, piece).toContain(piece);
  }
  expect(script).toMatch(/addEventListener\(["']click["']/);
});
