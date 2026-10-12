import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { toPosixRel } from '../../src/core/fs.ts';
import { expandImports, findImports } from '../../src/core/imports.ts';
import { fakeHome, tmpRepo } from '../helpers.ts';

const rel = (root: string, files: { abs: string }[]) => files.map((f) => toPosixRel(root, f.abs));

describe('findImports', () => {
  test('finds imports at line start and after whitespace', () => {
    expect(findImports('@a.md\nSee @docs/b.md and @c.md.')).toEqual(['a.md', 'docs/b.md', 'c.md.']);
  });

  test('ignores emails, inline code and fenced blocks', () => {
    const text = [
      'mail me@example.com',
      'literal `@README` here',
      '```',
      '@inside.md',
      '```',
      '~~~md',
      '@tilde.md',
      '~~~',
      '@after.md',
    ].join('\n');
    expect(findImports(text)).toEqual(['after.md']);
  });

  test('backslash-escaped spaces are part of the path', () => {
    expect(findImports('@Design\\ Docs/guide.md')).toEqual(['Design Docs/guide.md']);
  });

  test('quoted paths are not imports', () => {
    expect(findImports('@"a b.md"')).toEqual([]);
  });

  test('CRLF text', () => {
    expect(findImports('x\r\n@a.md\r\n')).toEqual(['a.md']);
  });
});

describe('expandImports', () => {
  test('resolves relative to the importing file, recursively', () => {
    const repo = tmpRepo({
      'CLAUDE.md': '@docs/a.md',
      'docs/a.md': 'A @sub/b.md',
      'docs/sub/b.md': 'B',
    });
    const root = path.join(repo, 'CLAUDE.md');
    const r = expandImports(root, '@docs/a.md', { maxDepth: 4 });
    expect(rel(repo, r.files)).toEqual(['docs/a.md', 'docs/sub/b.md']);
    expect(r.files.map((f) => f.depth)).toEqual([1, 2]);
    expect(toPosixRel(repo, r.files[1]?.importedFrom ?? '')).toBe('docs/a.md');
  });

  test('stops one past maxDepth and reports it', () => {
    const repo = tmpRepo({
      '1.md': '@2.md',
      '2.md': '@3.md',
      '3.md': '@4.md',
      '4.md': '@5.md',
      '5.md': 'deep',
    });
    const r = expandImports(path.join(repo, 'root.md'), '@1.md', { maxDepth: 4 });
    expect(rel(repo, r.files)).toEqual(['1.md', '2.md', '3.md', '4.md']);
    expect(rel(repo, r.tooDeep)).toEqual(['5.md']);
    const gemini = expandImports(path.join(repo, 'root.md'), '@1.md', { maxDepth: 5 });
    expect(gemini.tooDeep).toEqual([]);
  });

  test('cycles stop and nothing loads twice', () => {
    const repo = tmpRepo({ 'a.md': '@b.md', 'b.md': '@a.md @a.md' });
    const r = expandImports(path.join(repo, 'a.md'), '@b.md', { maxDepth: 4 });
    expect(rel(repo, r.files)).toEqual(['b.md']);
  });

  test('a shared seen set skips files loaded elsewhere', () => {
    const repo = tmpRepo({ 'shared.md': 'S' });
    const seen = new Set([path.join(repo, 'shared.md')]);
    const r = expandImports(path.join(repo, 'x.md'), '@shared.md', { maxDepth: 4, seen });
    expect(r.files).toEqual([]);
  });

  test('missing path-like import warns; a bare @mention does not', () => {
    const repo = tmpRepo({});
    const r = expandImports(path.join(repo, 'x.md'), '@missing.md thanks @alice', { maxDepth: 4 });
    expect(r.warnings.map((w) => w.message)).toEqual(['import not found: @missing.md']);
  });

  test('path with escaped space resolves on every OS', () => {
    const repo = tmpRepo({ 'my file.md': 'M' });
    const r = expandImports(path.join(repo, 'x.md'), '@my\\ file.md', { maxDepth: 4 });
    expect(rel(repo, r.files)).toEqual(['my file.md']);
  });

  test('@~/ imports need a home and resolve inside it', () => {
    const repo = tmpRepo({});
    const home = fakeHome({ '.claude/me.md': 'me' });
    const without = expandImports(path.join(repo, 'x.md'), '@~/.claude/me.md', { maxDepth: 4 });
    expect(without.files).toEqual([]);
    expect(without.warnings).toEqual([]);
    const withHome = expandImports(path.join(repo, 'x.md'), '@~/.claude/me.md', {
      maxDepth: 4,
      home,
    });
    expect(rel(home, withHome.files)).toEqual(['.claude/me.md']);
  });
});

describe('import boundary and absolute paths', () => {
  test('imports outside the boundary are skipped with a warning', () => {
    const outer = tmpRepo({ 'shared.md': 'S', 'repo/x.md': '' });
    const repo = path.join(outer, 'repo');
    const r = expandImports(path.join(repo, 'x.md'), '@../shared.md', {
      maxDepth: 4,
      boundary: repo,
    });
    expect(r.files).toEqual([]);
    expect(r.warnings[0]?.message).toMatch(/outside the repo not counted: @..\/shared.md/);
    const open = expandImports(path.join(repo, 'x.md'), '@../shared.md', { maxDepth: 4 });
    expect(open.files).toHaveLength(1);
  });

  test('absolute imports stay absolute', () => {
    const repo = tmpRepo({ 'docs/abs.md': 'A' });
    const target = path.join(repo, 'docs', 'abs.md').split(path.sep).join('/');
    const r = expandImports(path.join(repo, 'sub', 'x.md'), `@${target}`, { maxDepth: 4 });
    expect(rel(repo, r.files)).toEqual(['docs/abs.md']);
  });
});
