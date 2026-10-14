import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { openCommand } from '../src/open.ts';
import { EXIT, run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

describe('openCommand', () => {
  test('picks the right opener per platform', () => {
    expect(openCommand('a b.html', 'darwin')).toEqual({ command: 'open', args: ['a b.html'] });
    expect(openCommand('r.html', 'linux')).toEqual({ command: 'xdg-open', args: ['r.html'] });
    expect(openCommand('C:\r x\r.html', 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '""', '"C:\r x\r.html"'],
    });
  });
});

async function cli(
  argv: string[],
  cwd: string,
  open?: (file: string) => Promise<string | undefined>,
) {
  let stderr = '';
  const code = await run(argv, {
    stdout: () => {},
    stderr: (t) => {
      stderr += t;
    },
    env: {},
    isTTY: false,
    cwd,
    open,
  });
  return { code, stderr };
}

const repo = () => tmpRepo({ '.git/': '', 'AGENTS.md': '# Agents\n' });

describe('--open', () => {
  test('opens the written report', async () => {
    const dir = repo();
    const opened: string[] = [];
    const r = await cli(['--html', '--open'], dir, async (f) => {
      opened.push(f);
      return undefined;
    });
    expect(r.code).toBe(EXIT.ok);
    expect(opened).toEqual([path.join(dir, 'ctxsize-report.html')]);
    expect(r.stderr).not.toContain('Open it with');
  });

  test('without --open it prints the hint and opens nothing', async () => {
    const opened: string[] = [];
    const r = await cli(['--html'], repo(), async (f) => {
      opened.push(f);
      return undefined;
    });
    expect(opened).toEqual([]);
    expect(r.stderr).toContain('Wrote ');
    expect(r.stderr).toContain(
      'Open it with: ctxsize --html --open, or view it live with: ctxsize --serve',
    );
  });

  test('a failed open is a warning, not a failure', async () => {
    const r = await cli(['--html', '--open'], repo(), async () => 'spawn xdg-open ENOENT');
    expect(r.code).toBe(EXIT.ok);
    expect(r.stderr).toContain('could not open the browser: spawn xdg-open ENOENT');
  });

  test('--open alone is a usage error', async () => {
    const r = await cli(['--open'], repo());
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain('--open needs --html');
  });
});
