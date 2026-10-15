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
    expect(report.schemaVersion).toBe(2);
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

describe('ctxsize.json through the CLI', () => {
  const withConfig = (config: unknown) =>
    tmpRepo({
      '.git/': '',
      'ctxsize.json': typeof config === 'string' ? config : JSON.stringify(config),
      'NOTES.md': 'some notes\n',
    });

  test('--agents accepts a tool defined in the config and the table lists it', async () => {
    const dir = withConfig({
      tools: { notes: { label: 'Notes Bot', instructions: ['NOTES.md'] } },
    });
    const r = await cli(['--agents', 'notes'], dir);
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain('Notes Bot');
  });

  test('a bad config exits 2 and names the file and key', async () => {
    const r = await cli([], withConfig({ tools: { x: { label: 'X', instructoins: [] } } }));
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain('ctxsize.json');
    expect(r.stderr).toContain('instructoins');
  });

  test('invalid JSON in ctxsize.json exits 2', async () => {
    const r = await cli([], withConfig('{ nope'));
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain('invalid JSON');
  });
});

describe('--quiet', () => {
  test('prints one summary line instead of the table', async () => {
    const r = await cli(['--quiet'], repo());
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(r.stdout).toMatch(/^ctxsize: startup tokens \(estimates\): Claude Code ~\d/);
    expect(r.stdout).not.toContain('Cost of carrying it');
  });

  test('still prints gate failures on stderr and exits 1', async () => {
    const r = await cli(['--quiet', '--max-tokens', '1'], repo());
    expect(r.code).toBe(EXIT.overBudget);
    expect(r.stderr).toContain('over --max-tokens 1');
  });

  test('does not print the "Wrote" or "Open it with" messages', async () => {
    const dir = repo();
    const r = await cli(['--quiet', '--html'], dir);
    expect(r.code).toBe(EXIT.ok);
    expect(r.stderr).toBe('');
    expect(existsSync(path.join(dir, 'ctxsize-report.html'))).toBe(true);
  });

  test('--json is still printed in full', async () => {
    const r = await cli(['--quiet', '--json'], repo());
    expect(JSON.parse(r.stdout).schemaVersion).toBe(2);
  });

  test('cannot be combined with --watch or --serve', async () => {
    for (const flag of ['--watch', '--serve']) {
      const r = await cli(['--quiet', flag], repo());
      expect(r.code).toBe(EXIT.usage);
      expect(r.stderr).toContain('--quiet cannot be combined');
    }
  });
});

describe('--sort', () => {
  const sorted = () =>
    tmpRepo({
      '.git/': '',
      'AGENTS.md': '# Agents\n\nShared.\n',
      '.windsurf/rules/big.md': `# Rules\n\n${'Windsurf-only rule text. '.repeat(60)}\n`,
    });
  const labels = (stdout: string) =>
    stdout
      .split('\n')
      .slice(2, 12)
      .map((l) => l.trim().split(/\s{2,}/)[0])
      .filter((l): l is string => !!l && /^[A-Z]/.test(l) && l !== 'Agent');

  test('startup puts the biggest load first', async () => {
    const r = await cli(['--sort', 'startup'], sorted());
    expect(labels(r.stdout)[0]).toBe('Windsurf');
  });

  test('name sorts A to Z', async () => {
    const r = await cli(['--sort', 'name', '--all'], sorted());
    const names = labels(r.stdout);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  test('cost puts the most expensive first, in the cost table too', async () => {
    const r = await cli(['--sort', 'cost'], sorted());
    const cost = r.stdout.slice(r.stdout.indexOf('Cost of carrying it'));
    expect(cost.split('\n')[2]).toContain('Windsurf');
  });

  test('JSON keeps the tool order', async () => {
    const r = await cli(['--sort', 'name', '--json', '--all'], sorted());
    expect(JSON.parse(r.stdout).agents[0].agent).toBe('claude');
  });

  test('an unknown key is a usage error', async () => {
    const r = await cli(['--sort', 'size'], sorted());
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain('--sort must be one of startup, name, cost');
  });
});

describe('--top', () => {
  const many = () =>
    tmpRepo({
      '.git/': '',
      'AGENTS.md': '# Agents\n\nShared.\n',
      ...Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [
          `.windsurf/rules/r${i}.md`,
          `# Rule ${i}\n\n${'Rule text. '.repeat(10 + i)}\n`,
        ]),
      ),
    });
  const biggest = (stdout: string) => {
    const lines = stdout.split('\n');
    const start = lines.findIndex((l) => l.includes('Biggest files at startup'));
    const out: string[] = [];
    for (const l of lines.slice(start + 1)) {
      if (!l.trim()) break;
      out.push(l);
    }
    return out;
  };

  test('lists five files by default', async () => {
    expect(biggest((await cli([], many())).stdout)).toHaveLength(5);
  });

  test('--top 2 lists two, --top 7 lists seven', async () => {
    expect(biggest((await cli(['--top', '2'], many())).stdout)).toHaveLength(2);
    expect(biggest((await cli(['--top', '7'], many())).stdout)).toHaveLength(7);
  });

  test('--json topFiles follows --top', async () => {
    const r = await cli(['--top', '3', '--json', '--agents', 'windsurf'], many());
    expect(JSON.parse(r.stdout).agents[0].topFiles).toHaveLength(3);
  });

  test('a bad value is a usage error', async () => {
    for (const bad of ['0', 'x', '1.5']) {
      const r = await cli(['--top', bad], many());
      expect(r.code).toBe(EXIT.usage);
      expect(r.stderr).toContain('--top must be a positive whole number');
    }
  });
});

describe('--json metadata', () => {
  const withEnv = (env: Record<string, string>) => cli(['--json'], repo(), env);

  test('has the ctxsize version and a generatedAt time right after it', async () => {
    const before = Date.now();
    const report = JSON.parse((await cli(['--json'], repo())).stdout);
    expect(report.tool).toEqual({
      name: 'ctxsize',
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
    });
    expect(Object.keys(report).slice(0, 3)).toEqual(['schemaVersion', 'tool', 'generatedAt']);
    const at = Date.parse(report.generatedAt);
    expect(report.generatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test('SOURCE_DATE_EPOCH makes the output reproducible', async () => {
    const dir = repo();
    const a = (await cli(['--json'], dir, { SOURCE_DATE_EPOCH: '1760000000' })).stdout;
    const b = (await cli(['--json'], dir, { SOURCE_DATE_EPOCH: '1760000000' })).stdout;
    expect(a).toBe(b);
    expect(JSON.parse(a).generatedAt).toBe('2025-10-09T08:53:20.000Z');
  });

  test('a bad SOURCE_DATE_EPOCH is ignored', async () => {
    const report = JSON.parse((await withEnv({ SOURCE_DATE_EPOCH: 'soon' })).stdout);
    expect(Date.parse(report.generatedAt)).toBeGreaterThan(Date.parse('2026-01-01'));
  });
});
