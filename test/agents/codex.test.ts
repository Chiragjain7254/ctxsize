import path from 'node:path';
import { expect, test } from 'vitest';
import { load, validFallbackName } from '../../src/agents/codex.ts';
import type { LoaderContext, LoaderItem } from '../../src/core/types.ts';
import { fakeHome, tmpRepo } from '../helpers.ts';

const ctxFor = (
  root: string,
  opts: { cwd?: string; home?: string; env?: Record<string, string> } = {},
): LoaderContext => ({
  root,
  cwd: opts.cwd ? path.join(root, ...opts.cwd.split('/')) : root,
  env: opts.env ?? {},
  ...(opts.home ? { home: opts.home } : {}),
});

const startup = (items: LoaderItem[]) =>
  items.filter((i) => i.load === 'startup').map((i) => i.path);

test('AGENTS.override.md beats AGENTS.md in the same dir; the loser is ignored', async () => {
  const root = tmpRepo({ '.git/': '', 'AGENTS.override.md': 'override', 'AGENTS.md': 'base' });
  const { items } = await load(ctxFor(root));
  expect(items.map((i) => [i.path, i.load, i.reason])).toEqual([
    ['AGENTS.override.md', 'startup', 'AGENTS.override.md in repo root'],
    ['AGENTS.md', 'ignored', 'ignored: shadowed by AGENTS.override.md'],
  ]);
  expect(items[0]).toMatchObject({ category: 'instructions', scope: 'project', text: 'override' });
});

test('one file per dir, root to cwd, intermediate dirs included', async () => {
  const root = tmpRepo({
    '.git/': '',
    'AGENTS.md': 'root',
    'a/AGENTS.md': 'mid',
    'a/b/AGENTS.override.md': 'leaf override',
    'a/b/AGENTS.md': 'leaf',
    'other/AGENTS.md': 'not on the path',
  });
  const { items } = await load(ctxFor(root, { cwd: 'a/b' }));
  expect(startup(items)).toEqual(['AGENTS.md', 'a/AGENTS.md', 'a/b/AGENTS.override.md']);
  expect(items.map((i) => i.order)).toEqual([0, 1, 2, 3]);
  expect(items.map((i) => i.reason)).toEqual([
    'AGENTS.md in repo root',
    'AGENTS.md in a',
    'AGENTS.override.md in cwd',
    'ignored: shadowed by AGENTS.override.md',
  ]);
  expect(items.find((i) => i.path === 'a/b/AGENTS.md')?.load).toBe('ignored');
});

test('whitespace-only AGENTS.override.md still wins: the dir contributes nothing', async () => {
  const root = tmpRepo({ '.git/': '', 'AGENTS.override.md': ' \n\t\n', 'AGENTS.md': 'base' });
  const { items } = await load(ctxFor(root));
  expect(items.map((i) => [i.path, i.load, i.reason])).toEqual([
    ['AGENTS.override.md', 'ignored', 'ignored: empty file'],
    ['AGENTS.md', 'ignored', 'ignored: shadowed by AGENTS.override.md'],
  ]);
});

test('an empty AGENTS.md in a middle dir silences only that dir', async () => {
  const root = tmpRepo({
    '.git/': '',
    'AGENTS.md': 'root',
    'a/AGENTS.md': '',
    'a/TEAM.md': 'team',
    'a/b/AGENTS.md': 'leaf',
  });
  const config = 'project_doc_fallback_filenames = ["TEAM.md"]\n';
  const home = fakeHome({ '.codex/config.toml': config });
  const { items } = await load(ctxFor(root, { cwd: 'a/b', home }));
  expect(items.map((i) => [i.path, i.load, i.reason])).toEqual([
    ['AGENTS.md', 'startup', 'AGENTS.md in repo root'],
    ['a/AGENTS.md', 'ignored', 'ignored: empty file'],
    ['a/TEAM.md', 'ignored', 'ignored: shadowed by AGENTS.md'],
    ['a/b/AGENTS.md', 'startup', 'AGENTS.md in cwd'],
  ]);
});

test('lowercase agents.md is not loaded', async () => {
  const root = tmpRepo({ '.git/': '', 'agents.md': 'lower' });
  expect((await load(ctxFor(root))).items).toEqual([]);
});

test('fallback filenames come from the home config.toml, and only with home', async () => {
  const files = { '.git/': '', 'README.agent.md': 'readme', 'sub/TEAM.md': 'team' };
  const config = 'model = "x"\nproject_doc_fallback_filenames = ["TEAM.md", "README.agent.md"]\n';
  const home = fakeHome({ '.codex/config.toml': config });
  const root = tmpRepo(files);
  const withHome = await load(ctxFor(root, { cwd: 'sub', home }));
  expect(startup(withHome.items)).toEqual(['README.agent.md', 'sub/TEAM.md']);
  expect(withHome.items.map((i) => i.reason)).toEqual([
    'README.agent.md in repo root',
    'TEAM.md in cwd',
  ]);
  const without = await load(ctxFor(root, { cwd: 'sub' }));
  expect(without.items).toEqual([]);
});

test('fallback names that are not one file name, or repeat the defaults, are dropped', async () => {
  const config =
    'project_doc_fallback_filenames = ["", ".", "..", "sub/X.md", "N\\u0000UL.md", ' +
    '"AGENTS.md", "AGENTS.override.md", "TEAM.md", "TEAM.md"]\n';
  const home = fakeHome({ '.codex/config.toml': config });
  const root = tmpRepo({ '.git/': '', 'TEAM.md': 'team', 'sub/X.md': 'x' });
  const { items } = await load(ctxFor(root, { home }));
  expect(items.map((i) => [i.path, i.load])).toEqual([['TEAM.md', 'startup']]);
});

test('validFallbackName also rejects "\\" and ":" on Windows only', () => {
  for (const bad of ['', '.', '..', 'a/b.md', 'a\0b.md']) {
    expect(validFallbackName(bad, 'linux'), bad).toBe(false);
  }
  expect(validFallbackName('a\\b.md', 'linux')).toBe(true);
  expect(validFallbackName('a:b.md', 'darwin')).toBe(true);
  expect(validFallbackName('a\\b.md', 'win32')).toBe(false);
  expect(validFallbackName('a:b.md', 'win32')).toBe(false);
  expect(validFallbackName('TEAM.md', 'win32')).toBe(true);
});

test('fallback names in a TOML table are not top-level config', async () => {
  const config = '[profiles.x]\nproject_doc_fallback_filenames = ["TEAM.md"]\n';
  const home = fakeHome({ '.codex/config.toml': config });
  const root = tmpRepo({ '.git/': '', 'TEAM.md': 'team' });
  expect((await load(ctxFor(root, { home }))).items).toEqual([]);
});

test('global override beats global AGENTS.md and comes first', async () => {
  const home = fakeHome({ '.codex/AGENTS.override.md': 'g over', '.codex/AGENTS.md': 'g base' });
  const root = tmpRepo({ '.git/': '', 'AGENTS.md': 'root' });
  const { items } = await load(ctxFor(root, { home }));
  expect(items.map((i) => [i.path, i.load, i.scope, i.order, i.reason])).toEqual([
    ['~/.codex/AGENTS.override.md', 'startup', 'user', 0, 'user AGENTS.override.md (~/.codex)'],
    ['~/.codex/AGENTS.md', 'ignored', 'user', 1, 'ignored: shadowed by AGENTS.override.md'],
    ['AGENTS.md', 'startup', 'project', 2, 'AGENTS.md in repo root'],
  ]);
});

test('an empty global override still wins over global AGENTS.md; nothing without home', async () => {
  const home = fakeHome({ '.codex/AGENTS.override.md': '\n', '.codex/AGENTS.md': 'g base' });
  const root = tmpRepo({ '.git/': '' });
  const { items } = await load(ctxFor(root, { home }));
  expect(items.map((i) => [i.path, i.load, i.reason])).toEqual([
    ['~/.codex/AGENTS.override.md', 'ignored', 'ignored: empty file'],
    ['~/.codex/AGENTS.md', 'ignored', 'ignored: shadowed by AGENTS.override.md'],
  ]);
  expect((await load(ctxFor(root))).items).toEqual([]);
});

test('global AGENTS.md alone loads with the user reason', async () => {
  const home = fakeHome({ '.codex/AGENTS.md': 'g base' });
  const root = tmpRepo({ '.git/': '' });
  const { items } = await load(ctxFor(root, { home }));
  expect(items.map((i) => [i.path, i.load, i.reason])).toEqual([
    ['~/.codex/AGENTS.md', 'startup', 'user AGENTS.md (~/.codex)'],
  ]);
});

test('CODEX_HOME replaces ~/.codex', async () => {
  const home = fakeHome({ 'custom/AGENTS.md': 'custom', '.codex/AGENTS.md': 'default' });
  const root = tmpRepo({ '.git/': '' });
  const env = { CODEX_HOME: path.join(home, 'custom') };
  const { items } = await load(ctxFor(root, { home, env }));
  expect(items.map((i) => [i.path, i.text])).toEqual([['~/custom/AGENTS.md', 'custom']]);
});

test('skills from cwd and root .agents/skills are listed once when cwd is root', async () => {
  const root = tmpRepo({
    '.git/': '',
    '.agents/skills/deploy/SKILL.md':
      '---\nname: deploy\ndescription: Ship it\nwhen_to_use: Never\n---\nbody',
    '.agents/skills/lint/SKILL.md': '---\ndescription: Lint code\n---\n',
  });
  const { items } = await load(ctxFor(root));
  expect(items.map((i) => i.text)).toEqual(['- deploy: Ship it\n', '- lint: Lint code\n']);
  expect(items[0]).toMatchObject({
    path: '.agents/skills/deploy/SKILL.md',
    category: 'skills',
    load: 'startup',
    reason: 'skill listing entry',
    skill: { name: 'deploy', description: 'Ship it', bodyPath: '.agents/skills/deploy/SKILL.md' },
  });
  expect(items[0]?.skill).not.toHaveProperty('whenToUse');
});

test('a skill without a description is listed by name only, as other agents list it', async () => {
  const root = tmpRepo({ '.git/': '', '.agents/skills/bare/SKILL.md': '---\nname: bare\n---\n' });
  const { items } = await load(ctxFor(root));
  expect(items.map((i) => i.text)).toEqual(['- bare\n']);
});

test('skills scan cwd, its parent, root and home in order after instructions', async () => {
  const skill = (n: string) => `---\nname: ${n}\ndescription: d\n---\n`;
  const root = tmpRepo({
    '.git/': '',
    'AGENTS.md': 'root',
    '.agents/skills/r/SKILL.md': skill('root-skill'),
    'a/.agents/skills/p/SKILL.md': skill('parent-skill'),
    'a/b/.agents/skills/c/SKILL.md': skill('cwd-skill'),
  });
  const home = fakeHome({ '.agents/skills/u/SKILL.md': skill('user-skill') });
  const { items } = await load(ctxFor(root, { cwd: 'a/b', home }));
  const names = items.filter((i) => i.skill).map((i) => i.skill?.name);
  expect(names).toEqual(['cwd-skill', 'parent-skill', 'root-skill', 'user-skill']);
  expect(items.map((i) => i.order)).toEqual([0, 1, 2, 3, 4]);
  expect(items.at(-1)?.scope).toBe('user');
});

test('every item path is POSIX', async () => {
  const home = fakeHome({ '.codex/AGENTS.md': 'g', '.agents/skills/u/SKILL.md': 'x' });
  const root = tmpRepo({
    '.git/': '',
    'a/b/AGENTS.md': 'deep',
    'a/.agents/skills/s/SKILL.md': '---\ndescription: d\n---\n',
  });
  const { items } = await load(ctxFor(root, { cwd: 'a/b', home }));
  expect(items.length).toBeGreaterThan(2);
  for (const item of items) {
    expect(item.path).not.toContain('\\');
    if (item.skill) expect(item.skill.bodyPath).not.toContain('\\');
  }
});
