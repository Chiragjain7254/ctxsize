import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { starterConfig, starterWorkflow, suggestBudget } from '../src/init.ts';
import { run } from '../src/run.ts';
import { VERSION } from '../src/version.ts';
import { tmpRepo } from './helpers.ts';

vi.setConfig({ testTimeout: 30_000 });

async function cli(argv: string[], cwd: string, answers?: string[]) {
  let stdout = '';
  let stderr = '';
  const asked: string[] = [];
  const code = await run(argv, {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    env: {},
    isTTY: answers !== undefined,
    cwd,
    ask: answers
      ? async (q) => {
          asked.push(q);
          return answers.shift() ?? '';
        }
      : undefined,
  });
  return { code, stdout, stderr, asked };
}

const read = (dir: string, rel: string) => readFileSync(path.join(dir, ...rel.split('/')), 'utf8');
const has = (dir: string, rel: string) => existsSync(path.join(dir, ...rel.split('/')));

describe('ctxsize init', () => {
  test('the starter config is valid and points at the schema', () => {
    const config = JSON.parse(starterConfig());
    expect(config.$schema).toContain('ctxsize.schema.json');
    expect(() => parseConfig(config, 'ctxsize.json')).not.toThrow();
  });

  test('without a terminal it creates ctxsize.json only', async () => {
    const dir = tmpRepo({ '.git/': '', 'AGENTS.md': '# A\n' });
    const r = await cli(['init'], dir);
    expect(r.code).toBe(0);
    expect(has(dir, 'ctxsize.json')).toBe(true);
    expect(has(dir, '.github/workflows/ctxsize.yml')).toBe(false);
    expect(r.stderr).toContain('Created ctxsize.json');
    expect(r.asked).toEqual([]);
  });

  test("--workflow writes a workflow with the action and a budget above today's load", async () => {
    const dir = tmpRepo({ '.git/': '', 'AGENTS.md': `${'Use npm. '.repeat(100)}\n` });
    const r = await cli(['init', '--workflow'], dir);
    expect(r.code).toBe(0);
    const yml = read(dir, '.github/workflows/ctxsize.yml');
    expect(yml).toContain(`Chiragjain7254/ctxsize@v${VERSION}`);
    expect(yml).toMatch(/max-tokens: 2000\n/);
    expect(yml).toContain('permissions:\n  contents: read');
  });

  test('--max-tokens sets the budget', async () => {
    const dir = tmpRepo({ '.git/': '' });
    await cli(['init', '--workflow', '--max-tokens', '12_000'], dir);
    expect(read(dir, '.github/workflows/ctxsize.yml')).toContain('max-tokens: 12000');
  });

  test('never overwrites without --force', async () => {
    const dir = tmpRepo({ '.git/': '', 'ctxsize.json': '{"messages": 9}\n' });
    const r = await cli(['init', '--workflow'], dir);
    expect(r.code).toBe(0);
    expect(read(dir, 'ctxsize.json')).toBe('{"messages": 9}\n');
    expect(r.stderr).toContain('Kept ctxsize.json');
    const again = await cli(['init', '--workflow'], dir);
    expect(again.stderr).toContain('Kept .github/workflows/ctxsize.yml');
    writeFileSync(path.join(dir, '.github', 'workflows', 'ctxsize.yml'), 'mine\n');
    await cli(['init', '--workflow'], dir);
    expect(read(dir, '.github/workflows/ctxsize.yml')).toBe('mine\n');
    await cli(['init', '--workflow', '--force'], dir);
    expect(read(dir, 'ctxsize.json')).toContain('$schema');
    expect(read(dir, '.github/workflows/ctxsize.yml')).not.toBe('mine\n');
  });

  test('a ctxsize key in package.json counts as an existing config', async () => {
    const dir = tmpRepo({ '.git/': '', 'package.json': '{"ctxsize": {"messages": 5}}\n' });
    const r = await cli(['init'], dir);
    expect(has(dir, 'ctxsize.json')).toBe(false);
    expect(r.stderr).toContain('Kept ctxsize.json');
  });

  test('on a terminal it asks, and a plain Enter takes the defaults', async () => {
    const dir = tmpRepo({ '.git/': '' });
    const r = await cli(['init'], dir, ['', '']);
    expect(r.asked[0]).toContain('Create ctxsize.json? [Y/n]');
    expect(r.asked[1]).toContain('GitHub Actions workflow');
    expect(has(dir, 'ctxsize.json')).toBe(true);
    expect(has(dir, '.github/workflows/ctxsize.yml')).toBe(false);
  });

  test('on a terminal "y" adds the workflow and a typed budget wins', async () => {
    const dir = tmpRepo({ '.git/': '' });
    const r = await cli(['init'], dir, ['y', 'y', '4,000']);
    expect(r.code).toBe(0);
    expect(read(dir, '.github/workflows/ctxsize.yml')).toContain('max-tokens: 4000');
  });

  test('"n" skips ctxsize.json', async () => {
    const dir = tmpRepo({ '.git/': '' });
    await cli(['init', '--no-workflow'], dir, ['n']);
    expect(has(dir, 'ctxsize.json')).toBe(false);
  });

  test('--yes never asks, even on a terminal', async () => {
    const dir = tmpRepo({ '.git/': '' });
    const r = await cli(['init', '--yes'], dir, []);
    expect(r.asked).toEqual([]);
    expect(has(dir, 'ctxsize.json')).toBe(true);
  });

  test('bad flags are usage errors', async () => {
    const dir = tmpRepo({ '.git/': '' });
    expect((await cli(['init', '--workflow', '--no-workflow'], dir)).code).toBe(2);
    expect((await cli(['init', '--max-tokens', 'lots', '--workflow'], dir)).code).toBe(2);
    expect((await cli(['init', 'nope'], dir)).code).toBe(2);
    expect((await cli(['init', '--bogus'], dir)).code).toBe(2);
  });

  test('--help describes init', async () => {
    const r = await cli(['init', '--help'], tmpRepo({ '.git/': '' }));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('--workflow');
  });

  test('the budget leaves room above the heaviest agent', () => {
    expect(suggestBudget(0)).toBe(2000);
    expect(suggestBudget(4000)).toBe(5000);
    expect(suggestBudget(4001)).toBe(5500);
    expect(starterWorkflow(8000)).toContain('8,000 tokens');
  });
});
