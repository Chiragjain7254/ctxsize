import { describe, expect, test } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import type { LoadedItem } from '../src/core/types.ts';
import { topFiles, usageFor } from '../src/core/usage.ts';
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
  const dollars = { amount: 3, per: 1_000_000, currency: '$' };

  test('percent of window, overhead and cost at the price the user gave', () => {
    expect(usageFor(10_000, 200_000, 50, dollars)).toEqual({
      startupPctOfContext: 5,
      messages: 50,
      overheadTokens: 500_000,
      overheadCost: 1.5,
    });
  });

  test('the price can be per any number of tokens, in any currency', () => {
    const rupees = { amount: 250, per: 1_000_000, currency: '₹' };
    expect(usageFor(1634, 200_000, 1, rupees).overheadCost).toBeCloseTo(0.4085, 4);
    const per1k = { amount: 0.5, per: 1000, currency: 'EUR' };
    expect(usageFor(2000, 200_000, 10, per1k).overheadCost).toBe(10);
  });

  test('no price means no cost, not zero', () => {
    expect(usageFor(10_000, 200_000, 50, null).overheadCost).toBeNull();
  });

  test('an unknown window means an unknown share, not 0%', () => {
    expect(usageFor(10_000, null, 50, null).startupPctOfContext).toBeNull();
  });

  test('an empty startup load and a zero window do not divide by zero', () => {
    expect(usageFor(0, 200_000, 50, dollars)).toMatchObject({
      startupPctOfContext: 0,
      overheadTokens: 0,
    });
    expect(usageFor(10, 0, 50, dollars).startupPctOfContext).toBe(0);
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

  test('each tool gets its share of its own model window and its overhead tokens', async () => {
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
    // No price was given, so there is no cost anywhere.
    expect(report.price).toBeNull();
    expect(codex?.usage.overheadCost).toBeNull();
    expect(zed?.usage.overheadCost).toBeNull();
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

  test('the terminal and HTML show window share, model and overhead, and no cost without a price', async () => {
    const dir = repo();
    const term = (await cli(['--agents', 'codex,claude'], dir)).stdout;
    expect(term).toContain('% ctx');
    expect(term).toContain('What each agent carries');
    expect(term).not.toContain('Cost of carrying it');
    expect(term).not.toMatch(/$d/);
    expect(term).toContain('Add --price 3 --per 1m to see cost.');
    expect(term).toContain('50 messages');
    expect(term).toContain('GPT-5.3-Codex*');
    expect(term).toContain('Biggest files at startup');
    for (const line of term.split('\n')) expect(line.length).toBeLessThanOrEqual(110);

    const html = tmpRepo({});
    const out = `${html}/r.html`;
    expect((await cli(['--html', '--out', out, '--agents', 'codex'], dir)).code).toBe(EXIT.ok);
    const text = (await import('node:fs')).readFileSync(out, 'utf8');
    expect(text).toContain('"messages":50');
    expect(text).toContain('GPT-5.3-Codex');
  });

  test('--messages must be a positive whole number', async () => {
    expect((await cli(['--messages', '0'], repo())).code).toBe(EXIT.usage);
    expect((await cli(['--messages', 'abc'], repo())).code).toBe(EXIT.usage);
  });
});
