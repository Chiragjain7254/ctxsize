import path from 'node:path';
import { expect, test } from 'vitest';
import { load } from '../../src/agents/cursor.ts';
import type { LoaderContext, LoaderItem } from '../../src/core/types.ts';
import { tmpRepo } from '../helpers.ts';

const ctxFor = (root: string, cwd = root): LoaderContext => ({ root, cwd, env: {} });

async function loadRepo(files: Record<string, string>, cwdRel?: string) {
  const root = tmpRepo({ '.git/': '', ...files });
  const cwd = cwdRel ? path.join(root, ...cwdRel.split('/')) : root;
  return load(ctxFor(root, cwd));
}

function byPath(items: LoaderItem[], p: string): LoaderItem {
  const item = items.find((i) => i.path === p);
  if (!item) throw new Error(`no item ${p}; have ${items.map((i) => i.path).join(', ')}`);
  return item;
}

test('alwaysApply true loads at startup and ignores globs and description', async () => {
  const { items, warnings } = await loadRepo({
    '.cursor/rules/a.mdc': '---\nalwaysApply: true\nglobs: src/**\ndescription: x\n---\nBody\n',
  });
  expect(warnings).toEqual([]);
  expect(byPath(items, '.cursor/rules/a.mdc')).toMatchObject({
    agent: 'cursor',
    category: 'rules',
    scope: 'project',
    load: 'startup',
    reason: 'alwaysApply',
    text: 'Body\n',
    bytes: 5,
  });
});

test('globs as a comma string is on-demand and kept as written', async () => {
  const { items } = await loadRepo({
    '.cursor/rules/g.mdc': '---\nglobs: src/**/*.ts,test/**\nalwaysApply: false\n---\nG',
  });
  expect(byPath(items, '.cursor/rules/g.mdc')).toMatchObject({
    load: 'on-demand',
    reason: 'globs: src/**/*.ts,test/**',
  });
});

test('globs as a YAML array is joined', async () => {
  const { items } = await loadRepo({
    '.cursor/rules/g.mdc': '---\nglobs:\n  - "*.ts"\n  - "*.tsx"\n---\nG',
  });
  expect(byPath(items, '.cursor/rules/g.mdc')).toMatchObject({
    load: 'on-demand',
    reason: 'globs: *.ts, *.tsx',
  });
});

test('description only is agent-requested with a 60-char preview', async () => {
  const description = 'D'.repeat(80);
  const { items } = await loadRepo({
    '.cursor/rules/d.mdc': `---\ndescription: ${description}\n---\nBody`,
  });
  expect(byPath(items, '.cursor/rules/d.mdc')).toMatchObject({
    load: 'on-demand',
    reason: `agent-requested: ${'D'.repeat(60)}`,
    text: 'Body',
  });
});

test('no frontmatter fields is a manual rule', async () => {
  const { items } = await loadRepo({
    '.cursor/rules/m.mdc': 'Just text',
    '.cursor/rules/e.mdc': '---\nglobs:\ndescription: ""\n---\nEmpty fields',
  });
  for (const p of ['.cursor/rules/m.mdc', '.cursor/rules/e.mdc']) {
    expect(byPath(items, p)).toMatchObject({
      load: 'on-demand',
      reason: 'manual (@-mention only)',
    });
  }
});

test('.md and other files in .cursor/rules are ignored', async () => {
  const { items } = await loadRepo({
    '.cursor/rules/readme.md': '---\nalwaysApply: true\n---\nnope',
    '.cursor/rules/notes.txt': 'nope',
  });
  for (const p of ['.cursor/rules/readme.md', '.cursor/rules/notes.txt']) {
    expect(byPath(items, p)).toMatchObject({
      load: 'ignored',
      reason: 'only .mdc files are rules',
    });
  }
});

test('rules in subfolders of .cursor/rules are found', async () => {
  const { items } = await loadRepo({
    '.cursor/rules/sub/x.mdc': '---\nalwaysApply: true\n---\nX',
  });
  expect(byPath(items, '.cursor/rules/sub/x.mdc').load).toBe('startup');
});

test('CRLF frontmatter parses and the body excludes it', async () => {
  const { items } = await loadRepo({
    '.cursor/rules/c.mdc': '---\r\nalwaysApply: true\r\n---\r\nLine one\r\n',
  });
  const item = byPath(items, '.cursor/rules/c.mdc');
  expect(item.load).toBe('startup');
  expect(item.text).toBe('Line one\r\n');
  expect(item.text).not.toContain('alwaysApply');
});

// Lenient parsing rescues plain `key: value` lines, so only a block with none of them warns.
test('unreadable frontmatter warns and treats the rule as manual', async () => {
  const { items, warnings } = await loadRepo({
    '.cursor/rules/bad.mdc': '---\n[alwaysApply, true\n---\nBody',
  });
  expect(byPath(items, '.cursor/rules/bad.mdc')).toMatchObject({
    load: 'on-demand',
    reason: 'manual (@-mention only)',
  });
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatchObject({ agent: 'cursor', path: '.cursor/rules/bad.mdc' });
  expect(warnings[0]?.message).toMatch(/invalid YAML/);
});

test('root AGENTS.md is startup, nested AGENTS.md is on-demand', async () => {
  const { items } = await loadRepo({
    'AGENTS.md': 'root',
    'packages/a/AGENTS.md': 'nested',
  });
  expect(byPath(items, 'AGENTS.md')).toMatchObject({
    category: 'instructions',
    load: 'startup',
    reason: 'AGENTS.md',
    text: 'root',
  });
  expect(byPath(items, 'packages/a/AGENTS.md')).toMatchObject({
    category: 'instructions',
    load: 'on-demand',
    reason: 'applies when working in packages/a',
  });
});

test('AGENTS.md and .cursor/rules between root and cwd load; outer first', async () => {
  const { items } = await loadRepo(
    {
      'AGENTS.md': 'root',
      'packages/a/AGENTS.md': 'pkg',
      '.cursor/rules/r.mdc': 'root rule',
      'packages/a/.cursor/rules/p.mdc': 'pkg rule',
      'packages/a/src/AGENTS.md': 'below',
      'packages/b/AGENTS.md': 'sibling',
    },
    'packages/a',
  );
  expect(items.map((i) => [i.path, i.load, i.order])).toEqual([
    ['AGENTS.md', 'startup', 0],
    ['packages/a/AGENTS.md', 'startup', 1],
    ['.cursor/rules/r.mdc', 'on-demand', 2],
    ['packages/a/.cursor/rules/p.mdc', 'on-demand', 3],
    ['packages/a/src/AGENTS.md', 'on-demand', 4],
  ]);
});

test('nested .cursor/rules below cwd are on-demand whatever their type', async () => {
  const { items, warnings } = await loadRepo({
    '.cursor/rules/root.mdc': '---\nalwaysApply: true\n---\nRoot',
    'packages/x/.cursor/rules/always.mdc': '---\nalwaysApply: true\n---\nAlways',
    'packages/x/.cursor/rules/sub/globs.mdc': '---\nglobs: *.tsx\n---\nGlobs',
    'packages/x/.cursor/rules/readme.md': 'not a rule',
    'packages/x/src/deep/.cursor/rules/d.mdc': 'Deep',
    'packages/x/node_modules/y/.cursor/rules/n.mdc': 'skipped',
  });
  expect(warnings).toEqual([]);
  expect(items.map((i) => [i.path, i.load, i.reason, i.text])).toEqual([
    ['.cursor/rules/root.mdc', 'startup', 'alwaysApply', 'Root'],
    [
      'packages/x/.cursor/rules/always.mdc',
      'on-demand',
      'on demand: nested rules for packages/x',
      'Always',
    ],
    ['packages/x/.cursor/rules/readme.md', 'ignored', 'only .mdc files are rules', 'not a rule'],
    [
      'packages/x/.cursor/rules/sub/globs.mdc',
      'on-demand',
      'on demand: nested rules for packages/x',
      'Globs',
    ],
    [
      'packages/x/src/deep/.cursor/rules/d.mdc',
      'on-demand',
      'on demand: nested rules for packages/x/src/deep',
      'Deep',
    ],
  ]);
});

test("cwd's own .cursor/rules keep their type; rules below cwd are nested", async () => {
  const { items } = await loadRepo(
    {
      'packages/x/.cursor/rules/own.mdc': '---\nalwaysApply: true\n---\nOwn',
      'packages/x/lib/.cursor/rules/lib.mdc': '---\nalwaysApply: true\n---\nLib',
    },
    'packages/x',
  );
  expect(items.map((i) => [i.path, i.load, i.reason])).toEqual([
    ['packages/x/.cursor/rules/own.mdc', 'startup', 'alwaysApply'],
    [
      'packages/x/lib/.cursor/rules/lib.mdc',
      'on-demand',
      'on demand: nested rules for packages/x/lib',
    ],
  ]);
});

test('.cursorrules is emitted as a legacy startup rule after AGENTS.md', async () => {
  const { items } = await loadRepo({
    '.cursorrules': 'old rules',
    'AGENTS.md': 'root',
    '.cursor/rules/a.mdc': '---\nalwaysApply: true\n---\nA',
  });
  expect(items.map((i) => i.path)).toEqual(['AGENTS.md', '.cursorrules', '.cursor/rules/a.mdc']);
  expect(byPath(items, '.cursorrules')).toMatchObject({
    category: 'rules',
    load: 'startup',
    reason: 'legacy .cursorrules (no longer documented)',
    text: 'old rules',
    order: 1,
  });
});

test('unquoted globs as in the Cursor docs are read', async () => {
  const { items, warnings } = await loadRepo({
    '.cursor/rules/tsx.mdc': '---\nglobs: *.tsx\n---\nTSX',
    '.cursor/rules/both.mdc': '---\nalwaysApply: true\nglobs: **/*.ts\n---\nTS',
  });
  expect(warnings).toEqual([]);
  const tsx = byPath(items, '.cursor/rules/tsx.mdc');
  expect(tsx).toMatchObject({ load: 'on-demand', text: 'TSX' });
  expect(tsx.reason).toContain('globs');
  expect(tsx.reason).toContain('*.tsx');
  expect(byPath(items, '.cursor/rules/both.mdc')).toMatchObject({
    load: 'startup',
    reason: 'alwaysApply',
    text: 'TS',
  });
});

test('lowercase agents.md is not loaded', async () => {
  const { items } = await loadRepo({ 'agents.md': 'x', 'sub/agents.md': 'y' });
  expect(items).toEqual([]);
});

test('empty repo loads nothing and does not throw', async () => {
  expect(await loadRepo({})).toEqual({ items: [], warnings: [] });
});

test('every item path is POSIX', async () => {
  const { items } = await loadRepo({
    'AGENTS.md': 'r',
    'packages/a/AGENTS.md': 'n',
    '.cursorrules': 'l',
    '.cursor/rules/sub/deep/x.mdc': 'x',
    '.cursor/rules/sub/y.md': 'y',
  });
  expect(items).toHaveLength(5);
  for (const item of items) expect(item.path).not.toContain('\\');
  expect(items.find((i) => i.reason.includes('\\'))).toBeUndefined();
});
