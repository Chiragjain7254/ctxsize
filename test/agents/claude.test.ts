import { symlinkSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { load } from '../../src/agents/claude.ts';
import type { LoaderContext, LoaderResult } from '../../src/core/types.ts';
import { fakeHome, tmpRepo } from '../helpers.ts';

const run = (root: string, sub = '', home?: string): Promise<LoaderResult> => {
  const ctx: LoaderContext = {
    root,
    cwd: path.join(root, ...sub.split('/').filter(Boolean)),
    env: {},
    ...(home ? { home } : {}),
  };
  return load(ctx);
};

const summary = (r: LoaderResult) => r.items.map((i) => [i.path, i.load]);
const byPath = (r: LoaderResult, p: string) => r.items.find((i) => i.path === p);

test('CLAUDE.md at root and in cwd both load, outermost first', async () => {
  const root = tmpRepo({ '.git/': '', 'CLAUDE.md': 'root', 'pkg/CLAUDE.md': 'pkg' });
  const r = await run(root, 'pkg');
  expect(summary(r)).toEqual([
    ['CLAUDE.md', 'startup'],
    ['pkg/CLAUDE.md', 'startup'],
  ]);
  expect(r.items.map((i) => i.reason)).toEqual(['CLAUDE.md in ancestor', 'CLAUDE.md in cwd']);
  expect(r.items.map((i) => i.order)).toEqual([0, 1]);
  expect(r.items[0]).toMatchObject({ scope: 'project', category: 'instructions', bytes: 4 });
});

test('.claude/CLAUDE.md and CLAUDE.local.md load', async () => {
  const root = tmpRepo({
    '.git/': '',
    'CLAUDE.md': 'a',
    '.claude/CLAUDE.md': 'b',
    'CLAUDE.local.md': 'c',
  });
  const r = await run(root);
  expect(summary(r)).toEqual([
    ['CLAUDE.md', 'startup'],
    ['.claude/CLAUDE.md', 'startup'],
    ['CLAUDE.local.md', 'startup'],
  ]);
  expect(byPath(r, 'CLAUDE.local.md')?.reason).toBe('CLAUDE.local.md (personal)');
});

test('lowercase claude.md is not loaded', async () => {
  const root = tmpRepo({ '.git/': '', 'claude.md': 'x', 'sub/claude.md': 'y' });
  expect((await run(root)).items).toEqual([]);
});

test('AGENTS.md is used when there are no CLAUDE files', async () => {
  const root = tmpRepo({ '.git/': '', 'AGENTS.md': 'a', 'sub/.claude/AGENTS.md': 'b' });
  const r = await run(root, 'sub');
  expect(summary(r)).toEqual([
    ['AGENTS.md', 'startup'],
    ['sub/.claude/AGENTS.md', 'startup'],
  ]);
});

test('AGENTS.md is ignored when CLAUDE.local.md exists in an ancestor', async () => {
  const root = tmpRepo({ '.git/': '', 'CLAUDE.local.md': 'mine', 'sub/AGENTS.md': 'agents' });
  const r = await run(root, 'sub');
  expect(summary(r)).toEqual([
    ['CLAUDE.local.md', 'startup'],
    ['sub/AGENTS.md', 'ignored'],
  ]);
  expect(byPath(r, 'sub/AGENTS.md')?.reason).toBe('AGENTS.md ignored: CLAUDE.md present');
});

test('AGENTS.md imported by CLAUDE.md is loaded once, not also ignored', async () => {
  const root = tmpRepo({ '.git/': '', 'CLAUDE.md': '@AGENTS.md', 'AGENTS.md': 'shared' });
  const r = await run(root);
  expect(summary(r)).toEqual([
    ['CLAUDE.md', 'startup'],
    ['AGENTS.md', 'startup'],
  ]);
  expect(byPath(r, 'AGENTS.md')).toMatchObject({
    importedFrom: 'CLAUDE.md',
    reason: 'imported by CLAUDE.md',
  });
});

test('rules: nested files found, paths: makes them on-demand, only .md', async () => {
  const root = tmpRepo({
    '.git/': '',
    '.claude/rules/a/b/x.md': 'always',
    '.claude/rules/ts.md': '---\npaths:\n  - "src/**/*.ts"\n  - "lib/**"\n---\nTS rule',
    '.claude/rules/notes.txt': 'not a rule',
  });
  const r = await run(root);
  expect(summary(r)).toEqual([
    ['.claude/rules/a/b/x.md', 'startup'],
    ['.claude/rules/ts.md', 'on-demand'],
  ]);
  expect(byPath(r, '.claude/rules/ts.md')).toMatchObject({
    category: 'rules',
    reason: 'paths: src/**/*.ts, lib/**',
  });
  expect(byPath(r, '.claude/rules/ts.md')?.text).toContain('paths:');
});

test('subdirectory CLAUDE.md files are on-demand', async () => {
  const root = tmpRepo({
    '.git/': '',
    'CLAUDE.md': 'root',
    'pkg/api/CLAUDE.md': 'api',
    'pkg/web/.claude/CLAUDE.md': 'web',
  });
  const r = await run(root);
  expect(summary(r)).toEqual([
    ['CLAUDE.md', 'startup'],
    ['pkg/api/CLAUDE.md', 'on-demand'],
    ['pkg/web/.claude/CLAUDE.md', 'on-demand'],
  ]);
  expect(byPath(r, 'pkg/api/CLAUDE.md')?.reason).toBe('loads when Claude reads files in pkg/api');
  expect(byPath(r, 'pkg/web/.claude/CLAUDE.md')?.reason).toBe(
    'loads when Claude reads files in pkg/web',
  );
});

test('imports from a rule resolve relative to the rule file', async () => {
  const root = tmpRepo({
    '.git/': '',
    '.claude/rules/x.md': 'See @docs/guide.txt',
    '.claude/rules/docs/guide.txt': 'guide',
    'docs/guide.txt': 'wrong one',
  });
  const r = await run(root);
  expect(summary(r)).toEqual([
    ['.claude/rules/x.md', 'startup'],
    ['.claude/rules/docs/guide.txt', 'startup'],
  ]);
  expect(byPath(r, '.claude/rules/docs/guide.txt')).toMatchObject({
    category: 'rules',
    importedFrom: '.claude/rules/x.md',
    text: 'guide',
  });
});

test('imports of an on-demand file are on-demand', async () => {
  const root = tmpRepo({
    '.git/': '',
    '.claude/rules/x.md': '---\npaths: src/**\n---\n@more.md',
    '.claude/rules/more.md': '---\npaths: src/**\n---\nmore',
  });
  const r = await run(root);
  // more.md is a rule on its own, so it is not duplicated as an import of x.md.
  expect(summary(r)).toEqual([
    ['.claude/rules/more.md', 'on-demand'],
    ['.claude/rules/x.md', 'on-demand'],
  ]);
  const root2 = tmpRepo({ '.git/': '', 'a/CLAUDE.md': '@b.md', 'a/b.md': 'b' });
  expect(summary(await run(root2))).toEqual([
    ['a/CLAUDE.md', 'on-demand'],
    ['a/b.md', 'on-demand'],
  ]);
});

test('a file that is both imported and top-level is counted once', async () => {
  const root = tmpRepo({ '.git/': '', 'CLAUDE.md': '@sub/CLAUDE.md', 'sub/CLAUDE.md': 'sub' });
  const r = await run(root, 'sub');
  expect(summary(r)).toEqual([
    ['CLAUDE.md', 'startup'],
    ['sub/CLAUDE.md', 'startup'],
  ]);
  expect(byPath(r, 'sub/CLAUDE.md')?.importedFrom).toBeUndefined();
});

test('an import chain deeper than 4 gives a warning', async () => {
  const root = tmpRepo({
    '.git/': '',
    'CLAUDE.md': '@1.md',
    '1.md': '@2.md',
    '2.md': '@3.md',
    '3.md': '@4.md',
    '4.md': '@5.md',
    '5.md': 'too deep',
    'CLAUDE.local.md': '@missing.md',
  });
  const r = await run(root);
  expect(r.items.map((i) => i.path)).toEqual([
    'CLAUDE.md',
    '1.md',
    '2.md',
    '3.md',
    '4.md',
    'CLAUDE.local.md',
  ]);
  expect(r.warnings).toEqual([
    { agent: 'claude', path: '4.md', message: 'import too deep (max 4): 5.md' },
    { agent: 'claude', path: 'CLAUDE.local.md', message: 'import not found: @missing.md' },
  ]);
});

test('skills: exact listing entries, cwd-level dirs, no truncation', async () => {
  const long = 'x'.repeat(2000);
  const root = tmpRepo({
    '.git/': '',
    '.claude/skills/deploy/SKILL.md':
      '---\nname: deploy\ndescription: Ship it\nwhen_to_use: After merge\n---\nbody',
    '.claude/skills/big/SKILL.md': `---\ndescription: ${long}\n---\n`,
    'pkg/.claude/skills/lint/SKILL.md': '---\ndescription: Lint code\n---\n',
  });
  const r = await run(root, 'pkg');
  const skills = r.items.filter((i) => i.category === 'skills');
  expect(skills.map((s) => s.text)).toEqual([
    `- big: ${long}\n`,
    '- deploy: Ship it After merge\n',
    '- lint: Lint code\n',
  ]);
  expect(skills[1]).toMatchObject({
    path: '.claude/skills/deploy/SKILL.md',
    load: 'startup',
    reason: 'skill listing entry',
    skill: {
      name: 'deploy',
      description: 'Ship it',
      whenToUse: 'After merge',
      bodyPath: '.claude/skills/deploy/SKILL.md',
    },
  });
  expect(skills[2]?.skill).not.toHaveProperty('whenToUse');
});

test('skills: an empty description lists the name alone', async () => {
  const root = tmpRepo({
    '.git/': '',
    '.claude/skills/bare/SKILL.md': '---\nname: bare\n---\nbody',
    '.claude/skills/when/SKILL.md': '---\nwhen_to_use: Later\n---\nbody',
  });
  const r = await run(root);
  expect(r.items.map((i) => i.text)).toEqual(['- bare\n', '- when: Later\n']);
});

test('user files load only with home, before project files', async () => {
  const home = fakeHome({
    '.claude/CLAUDE.md': 'user',
    '.claude/rules/deep/style.md': 'style',
    '.claude/skills/mine/SKILL.md': '---\ndescription: Mine\n---\n',
  });
  const root = tmpRepo({ '.git/': '', 'CLAUDE.md': 'project', 'AGENTS.md': 'a' });
  expect(summary(await run(root))).toEqual([
    ['CLAUDE.md', 'startup'],
    ['AGENTS.md', 'ignored'],
  ]);
  const r = await run(root, '', home);
  expect(summary(r)).toEqual([
    ['~/.claude/CLAUDE.md', 'startup'],
    ['~/.claude/rules/deep/style.md', 'startup'],
    ['CLAUDE.md', 'startup'],
    ['~/.claude/skills/mine/SKILL.md', 'startup'],
    ['AGENTS.md', 'ignored'],
  ]);
  expect(byPath(r, '~/.claude/CLAUDE.md')?.scope).toBe('user');
});

test('user CLAUDE.md alone does not suppress project AGENTS.md', async () => {
  const home = fakeHome({ '.claude/CLAUDE.md': 'user' });
  const root = tmpRepo({ '.git/': '', 'AGENTS.md': 'a' });
  expect(summary(await run(root, '', home))).toEqual([
    ['~/.claude/CLAUDE.md', 'startup'],
    ['AGENTS.md', 'startup'],
  ]);
});

test('every path is POSIX and order is a single counter', async () => {
  const root = tmpRepo({
    '.git/': '',
    'CLAUDE.md': '@docs/guide.md',
    'docs/guide.md': 'g',
    'a/b/CLAUDE.md': 'nested',
    'a/.claude/rules/r/x.md': 'rule',
    '.claude/skills/s/SKILL.md': '---\ndescription: d\n---\n',
  });
  const r = await run(root, 'a');
  expect(r.items.length).toBe(5);
  for (const item of r.items) {
    expect(item.path).not.toContain('\\');
    expect(item.importedFrom ?? '').not.toContain('\\');
    expect(item.skill?.bodyPath ?? '').not.toContain('\\');
  }
  expect(byPath(r, 'docs/guide.md')?.path).toBe('docs/guide.md');
  expect(r.items.map((i) => i.order)).toEqual([0, 1, 2, 3, 4]);
});

test('imports outside the repo are skipped with a warning unless home is set', async () => {
  const outer = tmpRepo({
    'shared.md': 'shared',
    'repo/.git/': '',
    'repo/CLAUDE.md': '@../shared.md',
  });
  const root = path.join(outer, 'repo');
  const r = await run(root);
  expect(summary(r)).toEqual([['CLAUDE.md', 'startup']]);
  expect(r.warnings).toEqual([
    {
      agent: 'claude',
      path: 'CLAUDE.md',
      message: 'import outside the repo not counted: @../shared.md (use --include-user)',
    },
  ]);
  const withHome = await run(root, '', fakeHome());
  expect(withHome.items.map((i) => i.importedFrom)).toEqual([undefined, 'CLAUDE.md']);
});

test('rules: symlinked folders inside .claude/rules are followed', async () => {
  const root = tmpRepo({ '.git/': '', 'shared/style.md': 'style', '.claude/rules/x.md': 'x' });
  // A junction needs no admin rights on Windows; elsewhere it is a plain symlink.
  symlinkSync(path.join(root, 'shared'), path.join(root, '.claude', 'rules', 'linked'), 'junction');
  expect(summary(await run(root))).toEqual([
    ['.claude/rules/linked/style.md', 'startup'],
    ['.claude/rules/x.md', 'startup'],
  ]);
});
