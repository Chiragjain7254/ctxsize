// docs/VERIFY.md must show what ctxsize really predicts for examples/secret-word.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { EXAMPLE_DIR, parseTable, predict, readFruits, VERIFY_MD } from '../scripts/secret-word.ts';
import { analyze } from '../src/core/analyze.ts';
import { tmpRepo } from './helpers.ts';

test('the predicted columns in docs/VERIFY.md match ctxsize output', async () => {
  const table = parseTable(readFileSync(VERIFY_MD, 'utf8'));
  const predictions = await predict();
  expect([...table.keys()]).toEqual(predictions.map((p) => p.label));
  for (const p of predictions) {
    const cells = table.get(p.label) as string[];
    const words = (c: string | undefined): string[] => (c === 'none' ? [] : (c ?? '').split(', '));
    expect(words(cells[1]), `${p.label} startup`).toEqual(p.startup);
    expect(words(cells[2]), `${p.label} on demand`).toEqual(p.onDemand);
    expect(words(cells[3]), `${p.label} never`).toEqual(p.never);
  }
});

test('every fruit is unique and every fruit lands somewhere', () => {
  const fruits = readFruits(EXAMPLE_DIR);
  const words = fruits.map((f) => f.word);
  expect(new Set(words).size).toBe(words.length);
  expect(words).toEqual(expect.arrayContaining(['MANGO', 'BANANA', 'GRAPES']));
});

test('a folder with .ctxsizeignore is left out of a scan from above, but not from inside', async () => {
  const root = tmpRepo({
    '.git/': '',
    'CLAUDE.md': 'root',
    'sample/.ctxsizeignore': '',
    'sample/CLAUDE.md': 'sample',
    'sample/pkg/CLAUDE.md': 'nested sample',
  });
  const above = await analyze({ cwd: root, agents: ['claude'], checks: false });
  expect(above.agents[0]?.items.map((i) => i.path)).toEqual(['CLAUDE.md']);
  const inside = await analyze({ cwd: `${root}/sample`, root, agents: ['claude'], checks: false });
  expect(inside.agents[0]?.items.map((i) => i.path)).toContain('sample/CLAUDE.md');
});
