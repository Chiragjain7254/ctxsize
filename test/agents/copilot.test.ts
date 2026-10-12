import path from 'node:path';
import { expect, test } from 'vitest';
import { load } from '../../src/agents/copilot.ts';
import type { LoaderContext } from '../../src/core/types.ts';
import { tmpRepo } from '../helpers.ts';

const ctxFor = (root: string, cwd = root): LoaderContext => ({ root, cwd, env: {} });

const summary = async (ctx: LoaderContext) =>
  (await load(ctx)).items.map((i) => [i.path, i.category, i.load, i.reason]);

test('repository-wide copilot-instructions.md loads at startup', async () => {
  const root = tmpRepo({ '.git/': '', '.github/copilot-instructions.md': 'Use tabs.' });
  const { items, warnings } = await load(ctxFor(root));
  expect(items).toEqual([
    {
      agent: 'copilot',
      path: '.github/copilot-instructions.md',
      scope: 'project',
      category: 'instructions',
      load: 'startup',
      reason: 'repository-wide instructions',
      text: 'Use tabs.',
      bytes: 9,
      order: 0,
    },
  ]);
  expect(warnings).toEqual([]);
});

test('instructions files are classified by applyTo and excludeAgent', async () => {
  const root = tmpRepo({
    '.git/': '',
    '.github/instructions/a-ts.instructions.md':
      '---\napplyTo: "src/**/*.ts,src/**/*.tsx"\n---\nTS rules',
    '.github/instructions/b-all.instructions.md': '---\napplyTo: "**"\n---\nAll',
    '.github/instructions/c-ex.instructions.md':
      '---\napplyTo: "**"\nexcludeAgent: "cloud-agent"\n---\nx',
    '.github/instructions/d-exarr.instructions.md':
      '---\napplyTo: "**"\nexcludeAgent: ["code-review", "cloud-agent"]\n---\nx',
    '.github/instructions/e-review.instructions.md':
      '---\napplyTo: "docs/**"\nexcludeAgent: "code-review"\n---\nx',
    '.github/instructions/f-none.instructions.md': 'No frontmatter',
    '.github/instructions/nested/g.instructions.md': '---\napplyTo: "**/*"\n---\nx',
    '.github/instructions/notes.md': '---\napplyTo: "**"\n---\nnot an instructions file',
  });
  expect(await summary(ctxFor(root))).toEqual([
    [
      '.github/instructions/a-ts.instructions.md',
      'rules',
      'on-demand',
      'applyTo: src/**/*.ts,src/**/*.tsx',
    ],
    ['.github/instructions/b-all.instructions.md', 'rules', 'startup', 'applyTo: ** (all files)'],
    [
      '.github/instructions/c-ex.instructions.md',
      'rules',
      'ignored',
      'ignored: excludeAgent cloud-agent',
    ],
    [
      '.github/instructions/d-exarr.instructions.md',
      'rules',
      'ignored',
      'ignored: excludeAgent cloud-agent',
    ],
    ['.github/instructions/e-review.instructions.md', 'rules', 'on-demand', 'applyTo: docs/**'],
    ['.github/instructions/f-none.instructions.md', 'rules', 'ignored', 'ignored: no applyTo'],
    [
      '.github/instructions/nested/g.instructions.md',
      'rules',
      'startup',
      'applyTo: **/* (all files)',
    ],
  ]);
});

test('frontmatter is excluded from text, including CRLF files', async () => {
  const root = tmpRepo({
    '.git/': '',
    '.github/instructions/lf.instructions.md': '---\napplyTo: "**"\n---\nBody LF',
    '.github/instructions/crlf.instructions.md': '---\r\napplyTo: "src/**"\r\n---\r\nBody CRLF',
  });
  const { items } = await load(ctxFor(root));
  expect(items.map((i) => [i.path, i.text, i.load, i.reason])).toEqual([
    ['.github/instructions/crlf.instructions.md', 'Body CRLF', 'on-demand', 'applyTo: src/**'],
    ['.github/instructions/lf.instructions.md', 'Body LF', 'startup', 'applyTo: ** (all files)'],
  ]);
  expect(items[0]?.bytes).toBe(9);
});

test('unquoted applyTo globs are read', async () => {
  const root = tmpRepo({
    '.git/': '',
    '.github/instructions/tsx.instructions.md': '---\napplyTo: *.tsx\n---\nTSX',
    '.github/instructions/all.instructions.md': '---\napplyTo: **/*\n---\nAll',
  });
  const { items, warnings } = await load(ctxFor(root));
  expect(warnings).toEqual([]);
  expect(items.map((i) => [i.path, i.load, i.reason, i.text])).toEqual([
    ['.github/instructions/all.instructions.md', 'startup', 'applyTo: **/* (all files)', 'All'],
    ['.github/instructions/tsx.instructions.md', 'on-demand', 'applyTo: *.tsx', 'TSX'],
  ]);
});

test('invalid frontmatter warns instead of throwing', async () => {
  const root = tmpRepo({
    '.git/': '',
    // Not even a `key: value` line, so lenient parsing cannot rescue it.
    '.github/instructions/bad.instructions.md': '---\n[applyTo, unclosed\n---\nx',
  });
  const { items, warnings } = await load(ctxFor(root));
  expect(items.map((i) => i.load)).toEqual(['ignored']);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]?.path).toBe('.github/instructions/bad.instructions.md');
});

test('nearest AGENTS.md wins; ancestors are shadowed; deeper ones are on-demand', async () => {
  const root = tmpRepo({
    '.git/': '',
    'AGENTS.md': 'root',
    'pkg/AGENTS.md': 'pkg',
    'pkg/sub/deep/AGENTS.md': 'deep',
    'other/AGENTS.md': 'other',
  });
  expect(await summary(ctxFor(root, path.join(root, 'pkg')))).toEqual([
    ['pkg/AGENTS.md', 'instructions', 'startup', 'AGENTS.md in cwd'],
    ['AGENTS.md', 'instructions', 'ignored', 'ignored: shadowed by nearer AGENTS.md'],
    [
      'pkg/sub/deep/AGENTS.md',
      'instructions',
      'on-demand',
      'on demand: loads when working in pkg/sub/deep',
    ],
  ]);
});

test('cwd without AGENTS.md uses the nearest ancestor', async () => {
  const root = tmpRepo({ '.git/': '', 'AGENTS.md': 'root', 'pkg/src/': '' });
  expect(await summary(ctxFor(root, path.join(root, 'pkg', 'src')))).toEqual([
    ['AGENTS.md', 'instructions', 'startup', 'AGENTS.md in repo root'],
  ]);
});

test('a nearest AGENTS.md between root and cwd names its directory', async () => {
  const root = tmpRepo({ '.git/': '', 'pkg/AGENTS.md': 'pkg', 'pkg/src/': '' });
  expect(await summary(ctxFor(root, path.join(root, 'pkg', 'src')))).toEqual([
    ['pkg/AGENTS.md', 'instructions', 'startup', 'AGENTS.md in pkg'],
  ]);
});

test('AGENTS.md matching is case-sensitive', async () => {
  const root = tmpRepo({
    '.git/': '',
    'agents.md': 'lower',
    '.github/Copilot-Instructions.md': 'x',
  });
  expect(await summary(ctxFor(root))).toEqual([]);
});

test('root CLAUDE.md and GEMINI.md load, with a warning when AGENTS.md also loads', async () => {
  const root = tmpRepo({
    '.git/': '',
    '.github/copilot-instructions.md': 'repo',
    'AGENTS.md': 'agents',
    'CLAUDE.md': 'claude',
    'GEMINI.md': 'gemini',
    'sub/CLAUDE.md': 'not read',
  });
  const { items, warnings } = await load(ctxFor(root));
  expect(items.map((i) => [i.path, i.load, i.reason, i.order])).toEqual([
    ['.github/copilot-instructions.md', 'startup', 'repository-wide instructions', 0],
    ['AGENTS.md', 'startup', 'AGENTS.md in repo root', 1],
    ['CLAUDE.md', 'startup', 'CLAUDE.md in repo root (cloud agent)', 2],
    ['GEMINI.md', 'startup', 'GEMINI.md in repo root (cloud agent)', 3],
  ]);
  expect(warnings.map((w) => [w.agent, w.path])).toEqual([
    ['copilot', 'CLAUDE.md'],
    ['copilot', 'GEMINI.md'],
  ]);
  expect(warnings[0]?.message).toContain('counted as loaded');
});

test('root CLAUDE.md alone loads without a warning', async () => {
  const root = tmpRepo({ '.git/': '', 'CLAUDE.md': 'claude' });
  const { items, warnings } = await load(ctxFor(root));
  expect(items.map((i) => [i.path, i.load])).toEqual([['CLAUDE.md', 'startup']]);
  expect(warnings).toEqual([]);
});

test('empty repo gives nothing', async () => {
  const root = tmpRepo({ '.git/': '' });
  expect(await load(ctxFor(root))).toEqual({ items: [], warnings: [] });
});

test('every item path is POSIX', async () => {
  const root = tmpRepo({
    '.git/': '',
    '.github/copilot-instructions.md': 'x',
    '.github/instructions/deep/er/x.instructions.md': '---\napplyTo: "a/**"\n---\nx',
    'a/b/AGENTS.md': 'x',
  });
  const { items } = await load(ctxFor(root));
  expect(items).toHaveLength(3);
  for (const item of items) expect(item.path).not.toContain('\\');
  expect(items.map((i) => i.path)).toContain('.github/instructions/deep/er/x.instructions.md');
});
