import { describe, expect, test } from 'vitest';
import { EXIT, run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

async function cli(argv: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    env: {},
    isTTY: false,
    cwd,
  });
  return { code, stdout, stderr };
}

// About 150 tokens of AGENTS.md. With --context 1000 that is roughly 15% of the window.
const repo = () =>
  tmpRepo({
    '.git/': '',
    'AGENTS.md': `# Agents\n\n${'Run the tests before every commit. '.repeat(20)}\n`,
  });

describe('--max-percent', () => {
  test('exits 1 and names each agent over the share of its window', async () => {
    const r = await cli(
      ['--max-percent', '5', '--context', '1000', '--agents', 'codex,claude'],
      repo(),
    );
    expect(r.code).toBe(EXIT.overBudget);
    expect(r.stderr).toMatch(
      /Codex uses [\d.]+% of its 1,000-token context window at startup, over --max-percent 5/,
    );
    expect(r.stderr).toContain('Claude Code uses');
  });

  test('passes when every agent is under the limit', async () => {
    const r = await cli(['--max-percent', '50', '--context', '1000'], repo());
    expect(r.code).toBe(EXIT.ok);
    expect(r.stderr).toBe('');
  });

  test('works with the default model windows', async () => {
    const r = await cli(['--max-percent', '0'], repo());
    expect(r.code).toBe(EXIT.overBudget);
  });

  test('--max-tokens and --max-percent both report', async () => {
    const r = await cli(
      ['--max-tokens', '10', '--max-percent', '1', '--context', '1000', '--agents', 'codex'],
      repo(),
    );
    expect(r.code).toBe(EXIT.overBudget);
    expect(r.stderr).toContain('over --max-tokens 10');
    expect(r.stderr).toContain('over --max-percent 1');
  });

  test('a bad value is a usage error', async () => {
    for (const bad of ['abc', '101', '1e999']) {
      const r = await cli(['--max-percent', bad], repo());
      expect(r.code, bad).toBe(EXIT.usage);
      expect(r.stderr).toContain('--max-percent must be a number from 0 to 100');
    }
  });

  test('cannot be combined with --watch, --serve or --history', async () => {
    for (const flag of [['--watch'], ['--serve'], ['--history', '2']]) {
      const r = await cli(['--max-percent', '5', ...flag], repo());
      expect(r.code, flag.join(' ')).toBe(EXIT.usage);
      expect(r.stderr).toContain('--max-percent');
    }
  });
});
