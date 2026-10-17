import { describe, expect, test } from 'vitest';
import { hasGlobChars, matchGlob } from '../../src/core/glob.ts';

describe('matchGlob', () => {
  test('* stays inside one segment, ** crosses directories', () => {
    expect(matchGlob('*.md', 'a.md')).toBe(true);
    expect(matchGlob('*.md', 'dir/a.md')).toBe(false);
    expect(matchGlob('**/*.md', 'a.md')).toBe(true);
    expect(matchGlob('**/*.md', 'x/y/a.md')).toBe(true);
    expect(matchGlob('rules/**', 'rules/a/b.md')).toBe(true);
  });

  test('braces and ? work', () => {
    expect(matchGlob('*.{md,mdc}', 'a.mdc')).toBe(true);
    expect(matchGlob('*.{md,mdc}', 'a.txt')).toBe(false);
    expect(matchGlob('a?.md', 'ab.md')).toBe(true);
    expect(matchGlob('a?.md', 'a/.md')).toBe(false);
  });

  test('regex characters in a pattern are literal and matching is case-sensitive', () => {
    expect(matchGlob('.cursorrules', '.cursorrules')).toBe(true);
    expect(matchGlob('.cursorrules', 'xcursorrules')).toBe(false);
    expect(matchGlob('a+b(1).md', 'a+b(1).md')).toBe(true);
    expect(matchGlob('AGENTS.md', 'agents.md')).toBe(false);
  });

  test('hasGlobChars tells plain names from patterns', () => {
    expect(hasGlobChars('AGENTS.md')).toBe(false);
    expect(hasGlobChars('rules/*.md')).toBe(true);
  });
});

describe('matchGlob with ** in the middle of a pattern', () => {
  test('a/**/b matches zero or more directories between a and b', () => {
    expect(matchGlob('a/**/b', 'a/b')).toBe(true);
    expect(matchGlob('a/**/b', 'a/x/y/b')).toBe(true);
    expect(matchGlob('a/**/b', 'ab')).toBe(false);
  });

  test('** not followed by a slash crosses directories inside a name', () => {
    expect(matchGlob('src/**.ts', 'src/a/b.ts')).toBe(true);
    expect(matchGlob('src/**.ts', 'src/a.md')).toBe(false);
  });
});
