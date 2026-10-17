import { describe, expect, test } from 'vitest';
import { parseGitignore } from '../../src/core/gitignore.ts';

describe('parseGitignore', () => {
  test('a path no rule matches is undefined, not false', () => {
    expect(parseGitignore('dist/\n').ignores('src', true)).toBeUndefined();
  });

  test('a trailing slash only matches directories', () => {
    const ig = parseGitignore('build/\n');
    expect(ig.ignores('build', true)).toBe(true);
    expect(ig.ignores('build', false)).toBeUndefined();
  });

  test('a pattern without a slash matches the name at any depth', () => {
    const ig = parseGitignore('*.log\n');
    expect(ig.ignores('debug.log', false)).toBe(true);
    expect(ig.ignores('a/b/debug.log', false)).toBe(true);
  });

  test('a pattern with a slash is anchored to the .gitignore folder', () => {
    const ig = parseGitignore('/docs/out\n');
    expect(ig.ignores('docs/out', true)).toBe(true);
    expect(ig.ignores('pkg/docs/out', true)).toBeUndefined();
  });

  test('the last matching rule wins', () => {
    const ig = parseGitignore('*.md\n!KEEP.md\n');
    expect(ig.ignores('notes.md', false)).toBe(true);
    expect(ig.ignores('KEEP.md', false)).toBe(false);
  });
});
