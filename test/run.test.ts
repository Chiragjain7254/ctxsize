import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { EXIT, run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

async function cli(argv: string[], cwd: string, env: Record<string, string> = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    env,
    isTTY: false,
    cwd,
  });
  return { code, stdout, stderr };
}

const repo = () =>
  tmpRepo({
    '.git/': '',
    'AGENTS.md': '# Agents\n\nUse npm. Run the tests before every commit.\n',
    'sub/CLAUDE.md': '# Sub\n',
  });

describe('ctxsize CLI', () => {
  test('prints a table for every agent and exits 0', async () => {
    const r = await cli([], repo());
    expect(r.code).toBe(EXIT.ok);
    for (const label of ['Claude Code', 'Codex', 'Cursor', 'GitHub Copilot', 'Gemini CLI']) {
      expect(r.stdout).toContain(label);
    }
    expect(r.stdout).toContain('Tokens are estimates');
    expect(r.stdout).not.toContain('\u001b['); // no color when not a TTY
  });

  test('--json is valid, path-free and has no file contents', async () => {
    const dir = repo();
    const r = await cli(['--json'], dir);
    const report = JSON.parse(r.stdout);
    expect(report.schemaVersion).toBe(1);
    expect(report.root).toBe('.');
    expect(r.stdout).not.toContain('Use npm');
    expect(r.stdout).not.toContain(path.basename(dir));
    expect(r.stdout).not.toContain('\\\\');
  });

  test('the dir argument resolves relative to cwd, including Windows-style ".\\sub"', async () => {
    const dir = repo();
    const arg = process.platform === 'win32' ? '.\\sub' : './sub';
    const r = await cli(['--json', '--agents', 'claude', arg], dir);
    const [claude] = JSON.parse(r.stdout).agents;
    expect(claude.items.map((i: { path: string }) => i.path)).toContain('sub/CLAUDE.md');
  });

  test('--agents filters and keeps the canonical order', async () => {
    const r = await cli(['--json', '--agents', 'cursor,CODEX'], repo());
    expect(JSON.parse(r.stdout).agents.map((a: { agent: string }) => a.agent)).toEqual([
      'codex',
      'cursor',
    ]);
  });

  test.each([
    [['--agents', 'vim']],
    [['--context', 'abc']],
    [['--context', '0']],
    [['--max-tokens', '-1']],
    [['--out', 'x.html']],
    [['--nope']],
    [['a', 'b']],
    [['does-not-exist']],
  ])('usage error %j exits 2 with a message', async (argv) => {
    const r = await cli(argv, repo());
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toMatch(/^ctxsize: /);
    expect(r.stdout).toBe('');
  });

  test('--max-tokens: over budget exits 1 naming the agent, under exits 0', async () => {
    const dir = repo();
    const over = await cli(['--max-tokens', '5', '--agents', 'codex'], dir);
    expect(over.code).toBe(EXIT.overBudget);
    expect(over.stderr).toMatch(/Codex loads \d+ tokens at startup, over --max-tokens 5/);
    expect((await cli(['--max-tokens', '100000'], dir)).code).toBe(EXIT.ok);
  });

  test('--html writes a file, --out picks where', async () => {
    const dir = repo();
    const r = await cli(['--html', '--out', 'report.html'], dir);
    expect(r.code).toBe(EXIT.ok);
    expect(readFileSync(path.join(dir, 'report.html'), 'utf8')).toMatch(/^<!doctype html>/);
    expect(existsSync(path.join(dir, 'ctxsize-report.html'))).toBe(false);
  });

  test('empty directory: zeros, no crash', async () => {
    const r = await cli(['--json'], tmpRepo({ '.git/': '' }));
    expect(r.code).toBe(EXIT.ok);
    for (const agent of JSON.parse(r.stdout).agents) expect(agent.startup.total).toBe(0);
  });

  test('FORCE_COLOR enables color, NO_COLOR wins', async () => {
    const dir = repo();
    expect((await cli([], dir, { FORCE_COLOR: '1' })).stdout).toContain('\u001b[');
    expect((await cli([], dir, { FORCE_COLOR: '1', NO_COLOR: '' })).stdout).not.toContain(
      '\u001b[',
    );
  });

  test('--help and --version', async () => {
    expect((await cli(['--help'], repo())).stdout).toContain('Usage: ctxsize [dir]');
    expect((await cli(['-v'], repo())).stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  test('terminal output fits in 100 columns', async () => {
    const r = await cli([], repo());
    const table = r.stdout.split('\n').filter((l) => l.startsWith('  ') && !l.includes(':'));
    for (const line of table) expect(line.length).toBeLessThanOrEqual(100);
  });
});
