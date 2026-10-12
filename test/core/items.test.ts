import path from 'node:path';
import { expect, test } from 'vitest';
import { makeItem, readSkillsDir } from '../../src/core/items.ts';
import type { LoaderContext } from '../../src/core/types.ts';
import { fakeHome, tmpRepo } from '../helpers.ts';

const ctxFor = (root: string, home?: string): LoaderContext => ({
  root,
  cwd: root,
  env: {},
  ...(home ? { home } : {}),
});

test('makeItem fills POSIX paths, scope and UTF-8 bytes', () => {
  const root = tmpRepo({});
  const home = fakeHome();
  const ctx = ctxFor(root, home);
  const project = makeItem(ctx, 'claude', path.join(root, 'docs', 'a.md'), 'é', {
    category: 'instructions',
    load: 'startup',
    reason: 'test',
    order: 0,
    importedFrom: path.join(root, 'CLAUDE.md'),
  });
  expect(project).toMatchObject({ path: 'docs/a.md', scope: 'project', bytes: 2 });
  expect(project.importedFrom).toBe('CLAUDE.md');
  const user = makeItem(ctx, 'claude', path.join(home, '.claude', 'CLAUDE.md'), 'x', {
    category: 'instructions',
    load: 'startup',
    reason: 'test',
    order: 1,
  });
  expect(user).toMatchObject({ path: '~/.claude/CLAUDE.md', scope: 'user' });
});

test('readSkillsDir reads name, description and when_to_use in stable order', () => {
  const root = tmpRepo({
    'skills/b/SKILL.md': '---\nname: beta\ndescription: Second\n---\nbody',
    'skills/a/SKILL.md': '---\ndescription: >\n  First\n  skill\nwhen_to_use: Often\n---\n',
    'skills/no-skill/README.md': 'x',
    'skills/c/SKILL.md': '---\nname: gamma\n---\n',
  });
  const { skills, warnings } = readSkillsDir(ctxFor(root), 'claude', path.join(root, 'skills'));
  expect(skills.map((s) => [s.name, s.description, s.whenToUse])).toEqual([
    ['a', 'First skill', 'Often'],
    ['beta', 'Second', undefined],
    ['gamma', '', undefined],
  ]);
  expect(warnings).toEqual([
    { agent: 'claude', path: 'skills/c/SKILL.md', message: 'skill has no description' },
  ]);
});

test('readSkillsDir on a missing dir is empty', () => {
  const root = tmpRepo({});
  expect(readSkillsDir(ctxFor(root), 'codex', path.join(root, 'nope'))).toEqual({
    skills: [],
    warnings: [],
  });
});
