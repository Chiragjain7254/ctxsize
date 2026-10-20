import { describe, expect, test } from 'vitest';
import { renderLogo, shouldShowLogo } from '../src/logo.ts';
import { run } from '../src/run.ts';
import { VERSION } from '../src/version.ts';
import { tmpRepo } from './helpers.ts';

async function cli(
  argv: string[],
  opts: { isTTY?: boolean; env?: Record<string, string>; columns?: number } = {},
) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    env: opts.env ?? {},
    isTTY: opts.isTTY ?? false,
    cwd: tmpRepo({ '.git/': '', 'AGENTS.md': '# A\n' }),
    columns: opts.columns,
  });
  return { code, stdout, stderr };
}

const BARS = '██';
const stripColor = (s: string) =>
  s
    .split('\u001b[')
    .map((part, i) => (i === 0 ? part : part.slice(part.indexOf('m') + 1)))
    .join('');
const tty = { isTTY: true, columns: 100 };

describe('the logo', () => {
  test('--help and --version show it on a color terminal', async () => {
    const help = await cli(['--help'], tty);
    expect(help.stdout).toContain(BARS);
    expect(help.stdout).toContain(`ctxsize\u001b[0m v${VERSION}`);
    // The name and version are in the logo, not repeated on the next line.
    expect(help.stdout.split('ctxsize\u001b[0m v')).toHaveLength(2);
    expect(help.stdout).toContain('See what your AI coding agent reads before you type');
    const version = await cli(['--version'], tty);
    expect(version.stdout).toContain(BARS);
    expect(version.stdout).toContain(`v${VERSION}`);
  });

  test('it is three short lines, at most 40 columns wide', () => {
    const lines = stripColor(renderLogo(VERSION)).trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(40);
  });

  test('piped output has no logo, and --version stays a bare version', async () => {
    const help = await cli(['--help']);
    expect(help.stdout).not.toContain(BARS);
    expect(help.stdout.startsWith(`ctxsize v${VERSION}\n`)).toBe(true);
    expect((await cli(['--version'])).stdout).toBe(`${VERSION}\n`);
  });

  test.each([
    ['NO_COLOR', { env: { NO_COLOR: '1' } }],
    ['CI', { env: { CI: 'true' } }],
    ['TERM=dumb', { env: { TERM: 'dumb' } }],
    ['--no-color', { args: ['--no-color'] }],
    ['--json', { args: ['--json'] }],
    ['--quiet', { args: ['--quiet'] }],
    ['--markdown', { args: ['--markdown', '-'] }],
    ['a narrow terminal', { columns: 39 }],
    ['an unknown width', { columns: undefined }],
  ] as const)('no logo with %s', async (_name, extra) => {
    const args = 'args' in extra ? extra.args : [];
    const opts = { ...tty, ...extra };
    for (const flag of ['--help', '--version']) {
      const r = await cli([...args, flag], opts);
      expect(r.stdout, `${flag}`).not.toContain(BARS);
    }
  });

  test('a normal run never shows it, even on a terminal', async () => {
    const r = await cli([], tty);
    expect(r.stdout).not.toContain(BARS);
    expect(r.stdout).not.toContain('██');
  });

  test('the conditions in one place', () => {
    const ok = { isTTY: true, color: true, env: {}, columns: 80, plain: false };
    expect(shouldShowLogo(ok)).toBe(true);
    expect(shouldShowLogo({ ...ok, isTTY: false })).toBe(false);
    expect(shouldShowLogo({ ...ok, color: false })).toBe(false);
    expect(shouldShowLogo({ ...ok, plain: true })).toBe(false);
    expect(shouldShowLogo({ ...ok, columns: 40 })).toBe(true);
  });
});
