import { execFileSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { openRepo } from '../src/history.ts';
import { EXIT, run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

vi.setConfig({ testTimeout: 60_000 });

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  );

/** The 8.3 spelling of a folder (what CI runners put in TEMP), or undefined when there is none. */
function shortName(dir: string): string | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    const script = `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${dir}').ShortPath`;
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
    }).trim();
    return out && out.toLowerCase() !== dir.toLowerCase() ? out : undefined;
  } catch {
    return undefined;
  }
}

// Regression: on Windows CI the temp dir is C:\Users\RUNNER~1\..., git reports the long form,
// and --history/--diff analyzed the live files instead of each commit.
test('a repository reached through a Windows short path is still analyzed per commit', async (ctx) => {
  const dir = tmpRepo({});
  const short = shortName(dir);
  if (!short) return ctx.skip();

  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'CLAUDE.md'), 'alpha '.repeat(100));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'one');
  writeFileSync(path.join(dir, 'CLAUDE.md'), 'alpha '.repeat(400));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'two');

  const repo = await openRepo(short);
  expect(repo.sub).toBe('');
  expect(realpathSync.native(repo.top)).toBe(realpathSync.native(dir));

  let stdout = '';
  const code = await run(['--history', '2', '--json', '--agents', 'claude', short], {
    stdout: (t) => {
      stdout += t;
    },
    stderr: () => {},
    env: {},
    isTTY: false,
    cwd: short,
  });
  expect(code).toBe(EXIT.ok);
  const [first, second] = JSON.parse(stdout).history.map(
    (h: { tools: Record<string, number> }) => h.tools.claude as number,
  );
  expect(second).toBeGreaterThan(first);
});
