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

describe('tools.<id>.maxTokens in ctxsize.json', () => {
  const withBudget = (budgets: Record<string, number>, extra: Record<string, unknown> = {}) =>
    tmpRepo({
      '.git/': '',
      'AGENTS.md': `# Agents\n\n${'Run the tests before every commit. '.repeat(20)}\n`,
      'ctxsize.json': JSON.stringify({
        tools: Object.fromEntries(
          Object.entries(budgets).map(([id, maxTokens]) => [id, { maxTokens, ...extra }]),
        ),
      }),
    });

  test('fails only the tool that is over its own budget', async () => {
    const r = await cli(['--agents', 'codex,claude'], withBudget({ codex: 10, claude: 100000 }));
    expect(r.code).toBe(EXIT.overBudget);
    expect(r.stderr).toMatch(
      /Codex loads \d+ tokens at startup, over its budget of 10 \(tools\.codex\.maxTokens/,
    );
    expect(r.stderr).not.toContain('Claude Code loads');
  });

  test('passes when every tool is within its budget', async () => {
    expect((await cli([], withBudget({ codex: 100000, cursor: 100000 }))).code).toBe(EXIT.ok);
  });

  test('works for a tool defined in the config too', async () => {
    const root = tmpRepo({
      '.git/': '',
      'ACME.md': 'Acme rules. '.repeat(50),
      'ctxsize.json': JSON.stringify({
        tools: { acme: { label: 'Acme', instructions: ['ACME.md'], maxTokens: 5 } },
      }),
    });
    const r = await cli(['--agents', 'acme'], root);
    expect(r.code).toBe(EXIT.overBudget);
    expect(r.stderr).toContain('Acme loads');
  });

  test('is checked together with --max-tokens', async () => {
    const r = await cli(['--max-tokens', '1', '--agents', 'codex'], withBudget({ codex: 1 }));
    expect(r.stderr).toContain('over --max-tokens 1');
    expect(r.stderr).toContain('over its budget of 1');
  });

  test('must be a positive whole number', async () => {
    for (const bad of [0, -5, 1.5, '100']) {
      const root = tmpRepo({
        '.git/': '',
        'ctxsize.json': JSON.stringify({ tools: { codex: { maxTokens: bad } } }),
      });
      const r = await cli([], root);
      expect(r.code, String(bad)).toBe(EXIT.usage);
      expect(r.stderr).toContain('tools.codex.maxTokens: expected a positive whole number');
    }
  });
});

describe('--fail-on-warnings', () => {
  const noDescription = () =>
    tmpRepo({
      '.git/': '',
      'AGENTS.md': '# Agents\n',
      '.claude/skills/x/SKILL.md': '---\nname: x\n---\nBody\n',
    });
  const clean = () => tmpRepo({ '.git/': '', 'AGENTS.md': '# Agents\n\nRun the tests.\n' });

  test('exits 1 and prints each "!" check', async () => {
    const r = await cli(['--fail-on-warnings'], noDescription());
    expect(r.code).toBe(EXIT.overBudget);
    expect(r.stderr).toContain('skill x');
    expect(r.stderr).toContain('(--fail-on-warnings)');
  });

  test('without the flag the same repo exits 0', async () => {
    expect((await cli([], noDescription())).code).toBe(EXIT.ok);
  });

  test('a repo with no warnings passes', async () => {
    expect((await cli(['--fail-on-warnings'], clean())).code).toBe(EXIT.ok);
  });

  test('info-level checks do not fail it', async () => {
    const root = tmpRepo({
      '.git/': '',
      '.claude/skills/x/SKILL.md': '---\nname: x\ndescription: Formats the changelog\n---\nBody\n',
    });
    const r = await cli(['--fail-on-warnings', '--json'], root);
    const checks: { severity: string }[] = JSON.parse(r.stdout).checks;
    expect(checks.every((c) => c.severity !== 'warn')).toBe(true);
    expect(r.code).toBe(EXIT.ok);
  });

  test('--no-checks makes it a usage error', async () => {
    const r = await cli(['--fail-on-warnings', '--no-checks'], clean());
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain('--fail-on-warnings needs the checks');
  });

  test('cannot be combined with --watch, --serve or --history', async () => {
    for (const flag of [['--watch'], ['--serve'], ['--history', '2']]) {
      const r = await cli(['--fail-on-warnings', ...flag], clean());
      expect(r.code, flag.join(' ')).toBe(EXIT.usage);
    }
  });
});
