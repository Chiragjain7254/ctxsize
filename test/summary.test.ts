import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import {
  buildProblems,
  reportSummary,
  type SummaryAgent,
  summarize,
} from '../src/report/summary.ts';
import { renderTerminal } from '../src/report/terminal.ts';
import { tmpRepo } from './helpers.ts';

vi.setConfig({ testTimeout: 30_000 });

const agent = (over: Partial<SummaryAgent> & { label: string }): SummaryAgent => ({
  id: over.label.toLowerCase(),
  startup: 100,
  est: true,
  pct: 0.4,
  cost: 0.01,
  ...over,
});

test('names the agent that reads the most, with a ~ for an estimate', () => {
  const lines = summarize({
    messages: 80,
    agents: [
      agent({ label: 'Zed', startup: 103, pct: 0.01 }),
      agent({ label: 'Windsurf', startup: 3820, pct: 0.4 }),
    ],
    problems: [],
  });
  expect(lines[0]?.text).toBe(
    'Windsurf reads the most before your first message: ~3,820 tokens (0.4% of its memory).',
  );
});

test('says nothing is cut off when nothing is, and lists cut files when some are', () => {
  const none = summarize({ messages: 80, agents: [agent({ label: 'A' })], problems: [] });
  expect(none[1]).toMatchObject({ level: 'ok' });
  expect(none[1]?.text).toContain('Nothing is cut off');
  const cut = summarize({
    messages: 80,
    agents: [agent({ label: 'Acme Agent' })],
    problems: [
      {
        level: 'bad',
        code: 'file-truncated',
        title: 'x',
        short: 'ACME.md is too big for Acme Agent',
        fix: 'y',
        tools: ['acme'],
        paths: ['ACME.md'],
      },
    ],
  });
  expect(cut[1]).toEqual({
    level: 'bad',
    text: '1 file is cut off: ACME.md is too big for Acme Agent.',
  });
});

test('counts the things to fix and the optional tips', () => {
  const p = (level: 'warn' | 'info', short: string) => ({
    level,
    code: 'c',
    title: short,
    short,
    fix: 'f',
    tools: [],
    paths: [],
  });
  const lines = summarize({
    messages: 80,
    agents: [agent({ label: 'A' })],
    problems: [p('warn', 'one'), p('warn', 'two'), p('info', 'tip')],
  });
  expect(lines[2]?.text).toBe('2 things to fix: one, two. Plus 1 optional tip to save tokens.');
});

test('names the most expensive and the cheapest agent, and skips agents that read nothing', () => {
  const lines = summarize({
    messages: 80,
    agents: [
      agent({ label: 'Empty', startup: 0, cost: 0 }),
      agent({ label: 'Cheap', cost: 0.0131 }),
      agent({ label: 'Pricey', cost: 0.61 }),
    ],
    problems: [],
  });
  expect(lines.at(-1)?.text).toBe(
    'Most expensive over 80 messages: Pricey ($0.61). Cheapest: Cheap ($0.0131).',
  );
});

test('falls back to tokens when no price is known, and handles no agents', () => {
  const lines = summarize({
    messages: 80,
    agents: [
      agent({ label: 'A', startup: 50, cost: null }),
      agent({ label: 'B', startup: 90, cost: null }),
    ],
    problems: [],
  });
  expect(lines.at(-1)?.text).toContain('Reads the least: A (~50 tokens)');
  expect(summarize({ messages: 80, agents: [], problems: [] })).toHaveLength(1);
});

async function sample() {
  const root = tmpRepo({
    '.git/': '',
    'AGENTS.md': `${'Root rule text. '.repeat(1400)}\n`,
    '.claude/skills/nodesc/SKILL.md': '---\nname: nodesc\n---\nBody\n',
  });
  return analyze({ cwd: path.join(root), agents: ['codex', 'claude'] });
}

test('every problem has a title and a how-to-fix line in simple words, worst first', async () => {
  const report = await sample();
  const problems = buildProblems(report);
  expect(problems.length).toBeGreaterThan(0);
  for (const p of problems) {
    expect(p.title.length).toBeGreaterThan(10);
    expect(p.fix.length).toBeGreaterThan(10);
  }
  const order = problems.map((p) => p.level);
  expect(order).toEqual(
    [...order].sort((a, b) => 'bwi'.indexOf(a[0] ?? '') - 'bwi'.indexOf(b[0] ?? '')),
  );
  expect(problems.some((p) => p.code === 'skill-no-description')).toBe(true);
});

test('the terminal prints the summary and the fixes before the tables', async () => {
  const report = await sample();
  const text = renderTerminal(report, { color: false });
  const at = (s: string) => text.indexOf(s);
  expect(at('Summary')).toBeGreaterThan(-1);
  expect(at('Problems and how to fix')).toBeGreaterThan(at('Summary'));
  expect(at('How to fix:')).toBeGreaterThan(-1);
  expect(at('Agent ')).toBeGreaterThan(at('Problems and how to fix'));
  for (const line of reportSummary(report)) expect(text).toContain(line.text);
});
