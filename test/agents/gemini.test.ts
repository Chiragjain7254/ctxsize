import path from 'node:path';
import { expect, test } from 'vitest';
import { load } from '../../src/agents/gemini.ts';
import type { LoaderContext } from '../../src/core/types.ts';
import { fakeHome, tmpRepo } from '../helpers.ts';

const ctxFor = (root: string, opts: { cwd?: string; home?: string } = {}): LoaderContext => ({
  root,
  cwd: opts.cwd ? path.join(root, ...opts.cwd.split('/')) : root,
  env: {},
  ...(opts.home ? { home: opts.home } : {}),
});

const summary = (items: { path: string; load: string; order: number }[]) =>
  [...items].sort((a, b) => a.order - b.order).map((i) => [i.path, i.load]);

test('GEMINI.md at root and in cwd both load, outermost first', async () => {
  const root = tmpRepo({ '.git/': '', 'GEMINI.md': 'root', 'pkg/GEMINI.md': 'pkg' });
  const { items, warnings } = await load(ctxFor(root, { cwd: 'pkg' }));
  expect(summary(items)).toEqual([
    ['GEMINI.md', 'startup'],
    ['pkg/GEMINI.md', 'startup'],
  ]);
  expect(items.map((i) => i.reason)).toEqual(['GEMINI.md in ancestor', 'GEMINI.md in workspace']);
  expect(items[0]).toMatchObject({
    category: 'instructions',
    scope: 'project',
    text: 'root',
    bytes: 4,
  });
  expect(warnings).toEqual([]);
});

test('context.fileName array loads every name in config order', async () => {
  const root = tmpRepo({
    '.git/': '',
    '.gemini/settings.json': '{"context":{"fileName":["AGENTS.md","GEMINI.md"]}}',
    'GEMINI.md': 'g',
    'AGENTS.md': 'a',
  });
  const { items } = await load(ctxFor(root));
  expect(summary(items)).toEqual([
    ['AGENTS.md', 'startup'],
    ['GEMINI.md', 'startup'],
  ]);
});

test('context.fileName string form replaces the default', async () => {
  const root = tmpRepo({
    '.git/': '',
    '.gemini/settings.json': '{"context":{"fileName":"CONTEXT.md"}}',
    'GEMINI.md': 'g',
    'CONTEXT.md': 'c',
  });
  const { items } = await load(ctxFor(root));
  expect(summary(items)).toEqual([['CONTEXT.md', 'startup']]);
});

test('invalid settings JSON warns and falls back to GEMINI.md', async () => {
  const root = tmpRepo({ '.git/': '', '.gemini/settings.json': '{ nope', 'GEMINI.md': 'g' });
  const { items, warnings } = await load(ctxFor(root));
  expect(summary(items)).toEqual([['GEMINI.md', 'startup']]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatchObject({ agent: 'gemini', path: '.gemini/settings.json' });
  expect(warnings[0]?.message).toMatch(/invalid settings JSON/);
});

test('project settings override user settings; user settings read only with home', async () => {
  const home = fakeHome({ '.gemini/settings.json': '{"context":{"fileName":"USER.md"}}' });
  const root = tmpRepo({ '.git/': '', 'USER.md': 'u', 'GEMINI.md': 'g' });
  expect(summary((await load(ctxFor(root))).items)).toEqual([['GEMINI.md', 'startup']]);
  expect(summary((await load(ctxFor(root, { home }))).items)).toEqual([['USER.md', 'startup']]);

  const withProject = tmpRepo({
    '.git/': '',
    '.gemini/settings.json': '{"context":{"fileName":"GEMINI.md"}}',
    'USER.md': 'u',
    'GEMINI.md': 'g',
  });
  expect(summary((await load(ctxFor(withProject, { home }))).items)).toEqual([
    ['GEMINI.md', 'startup'],
  ]);
});

test('GEMINI.md in a subdirectory is on-demand', async () => {
  const root = tmpRepo({ '.git/': '', 'GEMINI.md': 'r', 'src/lib/GEMINI.md': 's' });
  const { items } = await load(ctxFor(root));
  expect(summary(items)).toEqual([
    ['GEMINI.md', 'startup'],
    ['src/lib/GEMINI.md', 'on-demand'],
  ]);
  expect(items[1]?.reason).toBe('loaded just-in-time when a tool touches src/lib');
});

test('imports expand after their importer with importedFrom set', async () => {
  const root = tmpRepo({
    '.git/': '',
    'GEMINI.md': 'see @docs/a.md\nand @b.md',
    'docs/a.md': 'a',
    'b.md': 'b',
    'pkg/GEMINI.md': 'pkg',
  });
  const { items } = await load(ctxFor(root, { cwd: 'pkg' }));
  expect(summary(items)).toEqual([
    ['GEMINI.md', 'startup'],
    ['docs/a.md', 'startup'],
    ['b.md', 'startup'],
    ['pkg/GEMINI.md', 'startup'],
  ]);
  expect(items[1]).toMatchObject({ importedFrom: 'GEMINI.md', reason: 'imported by GEMINI.md' });
});

test('imports allow depth 5 and warn at depth 6', async () => {
  const files: Record<string, string> = { '.git/': '', 'GEMINI.md': '@d1.md' };
  for (let i = 1; i <= 6; i++) files[`d${i}.md`] = i < 6 ? `@d${i + 1}.md` : 'end';
  const root = tmpRepo(files);
  const { items, warnings } = await load(ctxFor(root));
  expect(items.map((i) => i.path)).toEqual([
    'GEMINI.md',
    'd1.md',
    'd2.md',
    'd3.md',
    'd4.md',
    'd5.md',
  ]);
  expect(warnings).toEqual([
    { agent: 'gemini', path: 'd5.md', message: 'import too deep (max 5): d6.md' },
  ]);
});

test('a file imported and also loaded on its own is counted once', async () => {
  const root = tmpRepo({ '.git/': '', 'GEMINI.md': '@pkg/GEMINI.md', 'pkg/GEMINI.md': 'pkg' });
  const { items } = await load(ctxFor(root, { cwd: 'pkg' }));
  expect(summary(items)).toEqual([
    ['GEMINI.md', 'startup'],
    ['pkg/GEMINI.md', 'startup'],
  ]);
  expect(items[1]?.importedFrom).toBeUndefined();
});

test('global ~/.gemini/GEMINI.md loads first, only with a home', async () => {
  const home = fakeHome({ '.gemini/GEMINI.md': 'global' });
  const root = tmpRepo({ '.git/': '', 'GEMINI.md': 'r' });
  expect(summary((await load(ctxFor(root))).items)).toEqual([['GEMINI.md', 'startup']]);
  const { items } = await load(ctxFor(root, { home }));
  expect(summary(items)).toEqual([
    ['~/.gemini/GEMINI.md', 'startup'],
    ['GEMINI.md', 'startup'],
  ]);
  expect(items[0]).toMatchObject({ scope: 'user', reason: 'global context file' });
});

test('lowercase gemini.md is not loaded', async () => {
  const root = tmpRepo({ '.git/': '', 'gemini.md': 'x', 'sub/gemini.md': 'y' });
  expect((await load(ctxFor(root))).items).toEqual([]);
});

test('skills: .agents beats .gemini in the workspace, workspace beats user', async () => {
  const skill = (desc: string) => `---\ndescription: ${desc}\n---\nbody`;
  const home = fakeHome({
    '.gemini/skills/deploy/SKILL.md': skill('user deploy'),
    '.agents/skills/solo/SKILL.md': skill('user only'),
  });
  const root = tmpRepo({
    '.git/': '',
    '.gemini/skills/deploy/SKILL.md': skill('gemini deploy'),
    '.agents/skills/deploy/SKILL.md': skill('agents deploy'),
    '.gemini/skills/lint/SKILL.md': skill('lint it'),
  });
  const { items } = await load(ctxFor(root, { home }));
  expect(items.map((i) => [i.path, i.load, i.reason])).toEqual([
    ['~/.gemini/skills/deploy/SKILL.md', 'ignored', 'overridden by .agents/skills/deploy/SKILL.md'],
    ['.gemini/skills/deploy/SKILL.md', 'ignored', 'overridden by .agents/skills/deploy/SKILL.md'],
    ['.agents/skills/deploy/SKILL.md', 'startup', 'skill name and description injected at startup'],
    ['.gemini/skills/lint/SKILL.md', 'startup', 'skill name and description injected at startup'],
    ['~/.agents/skills/solo/SKILL.md', 'startup', 'skill name and description injected at startup'],
  ]);
  const winner = items[2];
  expect(winner).toMatchObject({
    category: 'skills',
    text: '- deploy: agents deploy\n',
    skill: {
      name: 'deploy',
      description: 'agents deploy',
      bodyPath: '.agents/skills/deploy/SKILL.md',
    },
  });

  const noHome = await load(ctxFor(root));
  expect(noHome.items.some((i) => i.path.startsWith('~/'))).toBe(false);
});

test('order is one counter and every path is POSIX', async () => {
  const home = fakeHome({
    '.gemini/GEMINI.md': 'g',
    '.gemini/skills/s/SKILL.md': '---\ndescription: d\n---\n',
  });
  const root = tmpRepo({
    '.git/': '',
    'GEMINI.md': '@docs/x.md',
    'docs/x.md': 'x',
    'a/b/GEMINI.md': 'ab',
    'a/b/c/GEMINI.md': 'abc',
  });
  const { items } = await load(ctxFor(root, { cwd: 'a/b', home }));
  expect(items.map((i) => i.order)).toEqual(items.map((_, n) => n));
  expect(summary(items)).toEqual([
    ['~/.gemini/GEMINI.md', 'startup'],
    ['GEMINI.md', 'startup'],
    ['docs/x.md', 'startup'],
    ['a/b/GEMINI.md', 'startup'],
    ['a/b/c/GEMINI.md', 'on-demand'],
    ['~/.gemini/skills/s/SKILL.md', 'startup'],
  ]);
  for (const item of items) {
    expect(item.path).not.toContain('\\');
    expect(item.importedFrom ?? '').not.toContain('\\');
    expect(item.skill?.bodyPath ?? '').not.toContain('\\');
  }
});

test('with a home the upward walk still stops at the repo root', async () => {
  const outer = tmpRepo({ 'GEMINI.md': 'above the repo', 'repo/.git/': '', 'repo/GEMINI.md': 'r' });
  const root = path.join(outer, 'repo');
  const home = fakeHome({ '.gemini/GEMINI.md': 'global' });
  const { items } = await load(ctxFor(root, { home }));
  expect(summary(items)).toEqual([
    ['~/.gemini/GEMINI.md', 'startup'],
    ['GEMINI.md', 'startup'],
  ]);
});
