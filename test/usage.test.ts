import { describe, expect, test } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import type { LoadedItem } from '../src/core/types.ts';
import { formatUsd, topFiles, usageFor } from '../src/core/usage.ts';
import { allModels } from '../src/models.ts';
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

describe('usageFor', () => {
  test('percent of window, overhead and cost', () => {
    expect(usageFor(10_000, 200_000, 50, 3)).toEqual({
      startupPctOfContext: 5,
      messages: 50,
      overheadTokens: 500_000,
      overheadCostUsd: 1.5,
    });
  });

  test('no price means no cost, not zero', () => {
    expect(usageFor(10_000, 200_000, 50, null).overheadCostUsd).toBeNull();
  });

  test('an empty startup load and a zero window do not divide by zero', () => {
    expect(usageFor(0, 200_000, 50, 3)).toMatchObject({
      startupPctOfContext: 0,
      overheadTokens: 0,
    });
    expect(usageFor(10, 0, 50, 3).startupPctOfContext).toBe(0);
  });
});

describe('formatUsd', () => {
  test.each([
    [null, 'n/a'],
    [0, '$0'],
    [0.00001, '<$0.0001'],
    [0.0288, '$0.0288'],
    [1.5, '$1.50'],
    [12, '$12.00'],
  ])('%s -> %s', (n, text) => {
    expect(formatUsd(n)).toBe(text);
  });
});

describe('topFiles', () => {
  const item = (path: string, tokens: number, load: LoadedItem['load'] = 'startup') =>
    ({ path, tokens, load, category: 'instructions' }) as LoadedItem;

  test('startup items only, biggest first, ties by path, limited', () => {
    const items = [
      item('b.md', 5),
      item('a.md', 5),
      item('big.md', 50),
      item('later.md', 99, 'on-demand'),
      item('empty.md', 0),
    ];
    expect(topFiles(items, 3).map((f) => f.path)).toEqual(['big.md', 'a.md', 'b.md']);
  });

  test('a skill is reported by name', () => {
    const skill = { ...item('.claude/skills/x/SKILL.md', 9), skill: { name: 'x' } } as LoadedItem;
    expect(topFiles([skill])[0]?.skill).toBe('x');
  });
});

describe('usage in reports', () => {
  const repo = () => tmpRepo({ '.git/': '', 'AGENTS.md': 'Use small commits. '.repeat(500) });

  test('each tool gets its share of its own model window, overhead and cost', async () => {
    const report = await analyze({
      cwd: repo(),
      agents: ['codex', 'zed'],
      messages: 10,
      models: {
        models: allModels(),
        choice: { perTool: { codex: 'gpt-5.3-codex', zed: 'claude-haiku-5-5' } },
      },
    });
    const [codex, zed] = report.agents;
    expect(report.messages).toBe(10);
    expect(codex?.usage.overheadTokens).toBe((codex?.startup.total ?? 0) * 10);
    expect(codex?.usage.startupPctOfContext).toBeCloseTo(
      ((codex?.startup.total ?? 0) / 400_000) * 100,
      2,
    );
    expect(codex?.usage.overheadCostUsd).toBeCloseTo(
      (((codex?.startup.total ?? 0) * 10) / 1e6) * 1.75,
      5,
    );
    expect(zed?.usage.overheadCostUsd).toBeLessThan(codex?.usage.overheadCostUsd ?? 0);
    expect(codex?.topFiles.map((f) => f.path)).toEqual(['AGENTS.md']);
  });

  test('--messages changes the overhead; the default is 50', async () => {
    const dir = repo();
    const base = JSON.parse((await cli(['--json', '--agents', 'codex'], dir)).stdout);
    const ten = JSON.parse(
      (await cli(['--json', '--agents', 'codex', '--messages', '10'], dir)).stdout,
    );
    expect(base.messages).toBe(50);
    expect(ten.messages).toBe(10);
    expect(base.agents[0].usage.overheadTokens).toBe(base.agents[0].startup.total * 50);
    expect(ten.agents[0].usage.overheadTokens).toBe(ten.agents[0].startup.total * 10);
  });

  test('messages can come from ctxsize.json, and --messages wins over it', async () => {
    const dir = tmpRepo({ '.git/': '', 'AGENTS.md': 'x\n', 'ctxsize.json': '{"messages": 7}' });
    expect(JSON.parse((await cli(['--json'], dir)).stdout).messages).toBe(7);
    expect(JSON.parse((await cli(['--json', '--messages', '3'], dir)).stdout).messages).toBe(3);
  });

  test('the terminal and HTML show window share, model, overhead and cost', async () => {
    const dir = repo();
    const term = (await cli(['--agents', 'codex,claude'], dir)).stdout;
    expect(term).toContain('% ctx');
    expect(term).toContain('Cost of carrying it');
    expect(term).toContain('50 messages');
    expect(term).toContain('GPT-5.3-Codex*');
    expect(term).toContain('Biggest files at startup');
    for (const line of term.split('\n')) expect(line.length).toBeLessThanOrEqual(110);

    const html = tmpRepo({});
    const out = `${html}/r.html`;
    expect((await cli(['--html', '--out', out, '--agents', 'codex'], dir)).code).toBe(EXIT.ok);
    const text = (await import('node:fs')).readFileSync(out, 'utf8');
    expect(text).toContain('Price, USD per 1M tokens');
    expect(text).toContain('"messages":50');
    expect(text).toContain('GPT-5.3-Codex');
  });

  test('--messages must be a positive whole number', async () => {
    expect((await cli(['--messages', '0'], repo())).code).toBe(EXIT.usage);
    expect((await cli(['--messages', 'abc'], repo())).code).toBe(EXIT.usage);
  });
});
