import path from 'node:path';
import { expect, test } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { AGENT_IDS } from '../src/core/types.ts';
import { renderHtml } from '../src/report/html.ts';
import { tmpRepo } from './helpers.ts';

const KiB = 1024;

async function html(files: Record<string, string>, sub = '') {
  const root = tmpRepo({ '.git/': '', ...files });
  const report = await analyze({ cwd: path.join(root, sub), agents: AGENT_IDS });
  return renderHtml(report);
}

test('is self-contained: no external URLs or fetches', async () => {
  const out = await html({ 'AGENTS.md': 'See https://example.com for docs.\n' });
  expect(out).not.toMatch(/\s(src|href)=["']?https?:/i);
  expect(out).not.toMatch(/fetch\(|XMLHttpRequest|@import url/);
  expect(out).not.toContain('example.com'); // file contents are never embedded
});

test('escapes file names so markup in them is inert', async () => {
  // Windows forbids < and > in file names, so the name is set on the report directly.
  const root = tmpRepo({ '.git/': '', 'AGENTS.md': 'x\n' });
  const report = await analyze({ cwd: root, agents: ['codex'] });
  const item = report.agents[0]?.items[0];
  if (item) item.path = '<script>alert(1)</script>.md';
  const out = renderHtml(report);
  expect(out).not.toContain('<script>alert(1)');
  expect(out).toContain('&#60;script&#62;');
});

test('one tab and one panel per agent, the first selected', async () => {
  const out = await html({ 'AGENTS.md': 'Use npm.\n' });
  expect(out.match(/role="tab"/g)).toHaveLength(5);
  expect(out.match(/role="tabpanel"/g)).toHaveLength(5);
  expect(out.match(/aria-selected="true"/g)).toHaveLength(1);
});

test('dropped and cut files are drawn hatched with a legend entry', async () => {
  const out = await html(
    {
      'AGENTS.md': `${'Root rule text. '.repeat(1400)}\n`,
      'pkg/AGENTS.md': `${'Package rule. '.repeat(1400)}\n`,
    },
    'pkg',
  );
  expect(out).toContain('class="tile cat-instructions lost"');
  expect(out).toContain('Dropped or cut off');
});

test('empty repo says so instead of drawing an empty map', async () => {
  expect(await html({})).toContain('Nothing from this repo loads at startup');
});

test('stays small for a typical repo', async () => {
  const files: Record<string, string> = { 'AGENTS.md': 'x\n'.repeat(500) };
  for (let i = 0; i < 60; i++) {
    files[`.claude/skills/s${i}/SKILL.md`] = `---\ndescription: Skill ${i}\n---\n`;
  }
  expect(Buffer.byteLength(await html(files))).toBeLessThan(200 * KiB);
});
