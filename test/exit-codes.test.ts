// One test per documented exit code and per reason for it (docs/CLI.md, "Exit codes").
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

const repo = () =>
  tmpRepo({
    '.git/': '',
    'AGENTS.md': `# Agents\n\n${'Run the tests before every commit. '.repeat(20)}\n`,
    '.claude/skills/x/SKILL.md': '---\nname: x\n---\nBody\n',
  });

test('the exit codes are 0, 1 and 2', () => {
  expect(EXIT).toEqual({ ok: 0, overBudget: 1, usage: 2 });
});

describe('exit 0', () => {
  test.each([
    [[]],
    [['--json']],
    [['--quiet']],
    [['--help']],
    [['--version']],
    [['--check-profiles']],
    [['--max-tokens', '1000000']],
    [['--max-percent', '100']],
    [['--agents', 'codex', '--max-tokens', '1000000']],
    [['--all', '--tree']],
  ])('ctxsize %j', async (argv) => {
    expect((await cli(argv, repo())).code).toBe(0);
  });

  test('a warning check does not fail the run without --fail-on-warnings', async () => {
    expect((await cli([], repo())).code).toBe(0);
  });
});

describe('exit 1: a gate failed', () => {
  test('--max-tokens', async () => {
    const r = await cli(['--max-tokens', '1'], repo());
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('over --max-tokens 1');
  });

  test('--max-percent', async () => {
    const r = await cli(['--max-percent', '0.01', '--context', '1000'], repo());
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('over --max-percent 0.01');
  });

  test('a per-tool budget in ctxsize.json', async () => {
    const root = tmpRepo({
      '.git/': '',
      'AGENTS.md': 'Run the tests. '.repeat(50),
      'ctxsize.json': '{ "tools": { "codex": { "maxTokens": 1 } } }',
    });
    const r = await cli(['--agents', 'codex'], root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('over its budget of 1');
  });

  test('--fail-on-warnings', async () => {
    const r = await cli(['--fail-on-warnings'], repo());
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('(--fail-on-warnings)');
  });

  test('the report is still printed when a gate fails', async () => {
    const r = await cli(['--max-tokens', '1'], repo());
    expect(r.stdout).toContain('Codex');
  });
});

describe('exit 2: usage error', () => {
  const notAGitRepo = () => tmpRepo({ 'AGENTS.md': '# A\n' });

  test.each([
    ['an unknown flag', ['--nope'], /Unknown option/i],
    ['a flag that needs a value', ['--agents'], /argument missing|requires an argument|--agents/i],
    ['a bad number', ['--context', 'lots'], /--context must be a positive whole number/],
    ['an unknown agent', ['--agents', 'emacs'], /unknown agent: emacs/],
    ['an unknown model', ['--model', 'gpt-99'], /unknown model "gpt-99"/],
    ['an unknown tool in --model', ['--model', 'emacs=claude-haiku-5-5'], /unknown tool "emacs"/],
    ['a bad --sort', ['--sort', 'size'], /--sort must be one of/],
    ['a bad --top', ['--top', '0'], /--top must be a positive whole number/],
    [
      'a bad --max-percent',
      ['--max-percent', '150'],
      /--max-percent must be a number from 0 to 100/,
    ],
    ['a bad --exclude', ['--exclude', '../x'], /--exclude must be a glob/],
    ['two directories', ['a', 'b'], /expected one directory/],
    ['a directory that does not exist', ['no-such-dir'], /not a directory/],
    ['--out without --html', ['--out', 'x.html'], /--out needs --html/],
    ['--open without --html', ['--open'], /--open needs --html/],
    ['--port without --serve', ['--port', '5000'], /--port needs --serve/],
    ['--quiet with --watch', ['--quiet', '--watch'], /--quiet cannot be combined/],
    ['--serve with --json', ['--serve', '--json'], /--serve cannot be combined with --json/],
    ['--watch with --max-tokens', ['--watch', '--max-tokens', '5'], /--watch cannot be combined/],
    [
      '--history with --max-tokens',
      ['--history', '2', '--max-tokens', '5'],
      /cannot be combined with --history/,
    ],
    [
      '--history with --diff',
      ['--history', '2', '--diff', 'main'],
      /use --diff or --history, not both/,
    ],
    ['--history out of range', ['--history', '500'], /--history must be between 1 and/],
    ['a bad git ref', ['--diff', '--upload-pack=x'], /ref|--diff/i],
  ])('%s', async (_name, argv, message) => {
    const r = await cli(argv, repo());
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(message);
  });

  test('a bad ctxsize.json', async () => {
    const root = tmpRepo({ '.git/': '', 'ctxsize.json': '{ "mesages": 1 }' });
    const r = await cli([], root);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown key "mesages"');
  });

  test('--diff and --history outside a git repository', async () => {
    for (const argv of [
      ['--diff', 'HEAD'],
      ['--history', '3'],
    ]) {
      const r = await cli(argv, notAGitRepo());
      expect(r.code, argv.join(' ')).toBe(2);
      expect(r.stderr).toContain('ctxsize:');
    }
  });

  test('a usage error prints how to get help and nothing on stdout', async () => {
    const r = await cli(['--nope'], repo());
    expect(r.stderr).toContain('Run ctxsize --help for usage.');
    expect(r.stdout).toBe('');
  });
});
