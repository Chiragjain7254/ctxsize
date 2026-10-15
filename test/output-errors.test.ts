// A report file that cannot be written is a usage error with a plain message, never a stack trace.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

async function cli(argv: string[], cwd: string) {
  let stderr = '';
  const code = await run(argv, {
    stdout: () => {},
    stderr: (t) => {
      stderr += t;
    },
    env: {},
    isTTY: false,
    cwd,
  });
  return { code, stderr };
}

const repo = () => tmpRepo({ '.git/': '', 'AGENTS.md': '# Agents\n' });

describe('an output path that cannot be written', () => {
  test.each([
    ['--html --out', (d: string) => ['--html', '--out', path.join(d, 'nope', 'r.html')]],
    ['--card', (d: string) => ['--card', path.join(d, 'nope', 'c.svg')]],
    ['--badge', (d: string) => ['--badge', path.join(d, 'nope', 'b.svg')]],
    ['--markdown', (d: string) => ['--markdown', path.join(d, 'nope', 'm.md')]],
  ])('%s exits 2 with one clear line', async (_flag, args) => {
    const dir = repo();
    const r = await cli(args(dir), dir);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ctxsize: cannot write .+: .+\n$/);
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });

  test('--history --html --out exits 2 too', async () => {
    const dir = tmpRepo({ 'AGENTS.md': '# Agents\n' });
    const git = (...a: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'x');
    const r = await cli(['--history', '1', '--html', '--out', dir], dir);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('ctxsize: cannot write');
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });

  test('says when the target is a folder', async () => {
    const dir = repo();
    const r = await cli(['--badge', dir], dir);
    expect(r.stderr).toContain('it is a folder, not a file');
  });
});
