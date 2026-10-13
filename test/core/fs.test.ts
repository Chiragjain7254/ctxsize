import { symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  ancestors,
  clearWalkCache,
  displayPath,
  fileExists,
  findRoot,
  isInside,
  readText,
  toPosixRel,
  walkFiles,
} from '../../src/core/fs.ts';
import { fakeHome, tmpRepo } from '../helpers.ts';

describe('toPosixRel', () => {
  test('converts win32 paths to POSIX on every OS', () => {
    expect(toPosixRel('C:\\r', 'C:\\r\\a\\CLAUDE.md', path.win32)).toBe('a/CLAUDE.md');
  });
  test('root itself is "."', () => {
    expect(toPosixRel('/r', '/r', path.posix)).toBe('.');
  });
});

describe('isInside', () => {
  test('sibling with shared prefix is outside', () => {
    expect(isInside('/repo', '/repo-other/x', path.posix)).toBe(false);
    expect(isInside('C:\\repo', 'D:\\repo\\x', path.win32)).toBe(false);
  });
  test('child is inside', () => {
    expect(isInside('C:\\repo', 'C:\\repo\\a\\b', path.win32)).toBe(true);
  });
});

describe('displayPath', () => {
  test('home files start with ~/', () => {
    const ctx = { root: 'C:\\work', home: 'C:\\Users\\me' };
    expect(displayPath('C:\\Users\\me\\.claude\\CLAUDE.md', ctx, path.win32)).toBe(
      '~/.claude/CLAUDE.md',
    );
  });
  test('files outside root and home print as absolute POSIX', () => {
    expect(displayPath('/etc/codex/skills/x', { root: '/work' }, path.posix)).toBe(
      '/etc/codex/skills/x',
    );
  });
});

describe('ancestors', () => {
  test('stops at the given root', () => {
    expect(ancestors('/r/a/b', '/r', path.posix)).toEqual(['/r/a/b', '/r/a', '/r']);
  });
  test('ends at a win32 drive root without looping', () => {
    expect(ancestors('C:\\a\\b', undefined, path.win32)).toEqual(['C:\\a\\b', 'C:\\a', 'C:\\']);
  });
  test('ends at / on POSIX', () => {
    expect(ancestors('/a', undefined, path.posix)).toEqual(['/a', '/']);
  });
});

describe('real file system', () => {
  test('findRoot finds the nearest .git', () => {
    const repo = tmpRepo({ '.git/': '', 'a/b/x.md': 'x' });
    expect(findRoot(path.join(repo, 'a', 'b'))).toBe(repo);
  });

  test('fileExists is case-exact even on case-insensitive file systems', () => {
    const repo = tmpRepo({ 'CLAUDE.md': 'x' });
    expect(fileExists(repo, 'CLAUDE.md')).toBe(true);
    expect(fileExists(repo, 'claude.md')).toBe(false);
  });

  test('fileExists is false for directories', () => {
    const repo = tmpRepo({ 'AGENTS.md/': '' });
    expect(fileExists(repo, 'AGENTS.md')).toBe(false);
  });

  test('readText strips a BOM and returns undefined for missing files', () => {
    const repo = tmpRepo({ 'a.md': '\uFEFFhello' });
    expect(readText(path.join(repo, 'a.md'))).toBe('hello');
    expect(readText(path.join(repo, 'missing.md'))).toBeUndefined();
  });

  test('walkFiles is recursive, code-point sorted and skips node_modules', () => {
    const repo = tmpRepo({
      'r/b.md': '',
      'r/a/z.md': '',
      'r/C.md': '',
      'r/node_modules/x.md': '',
    });
    const files = walkFiles(path.join(repo, 'r')).map((f) => toPosixRel(repo, f));
    expect(files).toEqual(['r/C.md', 'r/a/z.md', 'r/b.md']);
  });

  test('walkFiles skips build output and agent worktrees', () => {
    const repo = tmpRepo({
      'dist/CLAUDE.md': '',
      'target/x.md': '',
      '.claude/worktrees/agent-1/CLAUDE.md': '',
      '.claude/rules/a.md': '',
      'src/worktrees/keep.md': '',
    });
    const files = walkFiles(repo).map((f) => toPosixRel(repo, f));
    expect(files).toEqual(['.claude/rules/a.md', 'src/worktrees/keep.md']);
  });

  test('walkFiles follows symlinked dirs only when asked', () => {
    const repo = tmpRepo({ 'shared/rule.md': '', 'r/own.md': '' });
    // A junction needs no admin rights on Windows; elsewhere it is a plain symlink.
    symlinkSync(path.join(repo, 'shared'), path.join(repo, 'r', 'linked'), 'junction');
    const rel = (opts?: { followSymlinks: boolean }) =>
      walkFiles(path.join(repo, 'r'), opts).map((f) => toPosixRel(repo, f));
    expect(rel()).toEqual(['r/own.md']);
    clearWalkCache();
    expect(rel({ followSymlinks: true })).toEqual(['r/linked/rule.md', 'r/own.md']);
  });

  test('fakeHome is never the real home', () => {
    expect(fakeHome()).not.toBe(os.homedir());
  });
});

describe('walkFiles and .gitignore', () => {
  test('skips ignored folders but keeps ignored files and agent folders', () => {
    const files: Record<string, string> = {
      '.git/': '',
      '.gitignore': 'big-cache/\n/generated\n*.log\nsub/tmp\n!keep\n.claude/\n',
      'CLAUDE.local.md': 'x',
      'a.log': 'x',
      'src/AGENTS.md': 'x',
      'sub/tmp/AGENTS.md': 'x',
      'sub/ok/AGENTS.md': 'x',
      'generated/AGENTS.md': 'x',
      '.claude/rules/r.md': 'x',
    };
    // A large ignored folder: many files that must never be visited.
    for (let i = 0; i < 300; i++) files[`big-cache/d${i % 10}/f${i}.md`] = 'x';
    const root = tmpRepo(files);
    clearWalkCache();
    const rel = walkFiles(root).map((f) => toPosixRel(root, f));
    expect(rel.some((r) => r.startsWith('big-cache/'))).toBe(false);
    expect(rel).not.toContain('generated/AGENTS.md');
    expect(rel).not.toContain('sub/tmp/AGENTS.md');
    expect(rel).toContain('sub/ok/AGENTS.md');
    expect(rel).toContain('src/AGENTS.md');
    expect(rel).toContain('CLAUDE.local.md');
    expect(rel).toContain('.claude/rules/r.md');
    clearWalkCache();
    const all = walkFiles(root, { gitignore: false }).map((f) => toPosixRel(root, f));
    expect(all.filter((r) => r.startsWith('big-cache/'))).toHaveLength(300);
  });

  test('always skips node_modules, dist, build and .git without a .gitignore', () => {
    const root = tmpRepo({
      '.git/HEAD': 'x',
      'node_modules/p/AGENTS.md': 'x',
      'dist/AGENTS.md': 'x',
      'build/AGENTS.md': 'x',
      'AGENTS.md': 'x',
    });
    clearWalkCache();
    expect(walkFiles(root).map((f) => toPosixRel(root, f))).toEqual(['AGENTS.md']);
  });
});
