import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { buildPageData, renderHtml } from '../src/report/html.ts';
import {
  buildProblems,
  insights,
  type Problem,
  reportSummary,
  type SummaryAgent,
  statusOf,
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

const problem = (level: Problem['level'], over: Partial<Problem> = {}): Problem => ({
  level,
  code: 'c',
  title: 'title',
  short: 'short',
  fix: 'fix',
  tools: ['a'],
  paths: [],
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
  expect(lines[1]?.text).toBe(
    'Windsurf reads the most before your first message: ~3,820 tokens (0.4% of its memory).',
  );
});

test('the verdict is one line with one total, never "N more"', () => {
  const a = [agent({ label: 'A', id: 'a' })];
  const none = insights({ messages: 80, agents: a, problems: [] }).verdict;
  expect(none).toEqual({
    level: 'ok',
    text: 'All good — nothing is cut off and nothing needs fixing.',
  });
  const cutAndFix = insights({
    messages: 80,
    agents: a,
    problems: [
      problem('bad', { code: 'file-truncated' }),
      problem('warn'),
      problem('warn'),
      problem('warn'),
      problem('warn'),
    ],
  });
  expect(cutAndFix.verdict.text).toBe(
    'Mostly fine — 1 file is cut off, and 5 things are worth fixing in all.',
  );
  expect(cutAndFix.toFix).toBe(5);
  expect(cutAndFix.cutOff).toBe(1);
  const only = insights({ messages: 80, agents: a, problems: [problem('warn')] }).verdict;
  expect(only.text).toBe('Mostly fine — nothing is cut off, but 1 thing is worth fixing.');
  const text = summarize({
    messages: 80,
    agents: a,
    problems: [problem('bad', { code: 'file-truncated' }), problem('warn')],
  })
    .map((l) => l.text)
    .join('\n');
  expect(text).not.toMatch(/\bmore\b/);
});

test('optional tips are counted apart from the things to fix', () => {
  const i = insights({
    messages: 80,
    agents: [agent({ label: 'A', id: 'a' })],
    problems: [problem('warn'), problem('warn'), problem('info')],
  });
  expect(i.toFix).toBe(2);
  expect(i.tips).toBe(1);
  expect(i.fixFirst).toHaveLength(2);
  const lines = summarize({
    messages: 80,
    agents: [agent({ label: 'A', id: 'a' })],
    problems: [problem('warn'), problem('warn'), problem('info')],
  });
  expect(lines.at(-1)?.text).toBe('Plus 1 optional tip to save tokens.');
});

test('the first screen shows at most 3 things to fix, worst first', () => {
  const i = insights({
    messages: 80,
    agents: [agent({ label: 'A', id: 'a' })],
    problems: [1, 2, 3, 4, 5].map((n) => problem('warn', { title: `t${n}` })),
  });
  expect(i.fixFirst.map((p) => p.title)).toEqual(['t1', 't2', 't3']);
  expect(i.toFix).toBe(5);
});

test('problems of an agent that is not shown are ignored', () => {
  const i = insights({
    messages: 80,
    agents: [agent({ label: 'A', id: 'a' })],
    problems: [problem('bad', { tools: ['b'], code: 'file-truncated' }), problem('warn')],
  });
  expect(i.cutOff).toBe(0);
  expect(i.toFix).toBe(1);
});

test('cheapest considers every shown agent, or says what it leaves out', () => {
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
    'Most expensive over 80 messages: Pricey ($0.6100). Cheapest: Cheap ($0.0131). Empty is left out because it reads nothing from this repo.',
  );
  const all = summarize({
    messages: 80,
    agents: [agent({ label: 'Cheap', cost: 0.0131 }), agent({ label: 'Pricey', cost: 0.61 })],
    problems: [],
  });
  expect(all.at(-1)?.text).toBe(
    'Most expensive over 80 messages: Pricey ($0.6100). Cheapest: Cheap ($0.0131).',
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
  expect(insights({ messages: 80, agents: [], problems: [] }).verdict.text).toBe(
    'No agent files found in this repo.',
  );
});

test('an agent status comes from the same problem list as everything else', () => {
  const ps = [
    problem('bad', { tools: ['a'] }),
    problem('warn', { tools: ['a', 'b'] }),
    problem('info', { tools: ['c'] }),
  ];
  expect(statusOf(ps, 'a')).toEqual({ level: 'bad', bad: 1, warn: 1, tips: 0 });
  expect(statusOf(ps, 'b')).toEqual({ level: 'warn', bad: 0, warn: 1, tips: 0 });
  expect(statusOf(ps, 'c')).toEqual({ level: 'ok', bad: 0, warn: 0, tips: 1 });
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

test('a problem in a skill is attributed to the agent that loads the skill, so it is not "Fine"', async () => {
  const report = await sample();
  const problems = buildProblems(report);
  const skill = problems.find((p) => p.code === 'skill-no-description');
  expect(skill?.tools).toEqual(['claude']);
  expect(statusOf(problems, 'claude').level).toBe('warn');
  expect(statusOf(problems, 'codex').level).toBe('ok');
});

test('no problem is left without an agent, and an agent marked fine has no problem anywhere', async () => {
  const root = tmpRepo({
    '.git/': '',
    'AGENTS.md': 'Use npm.\n',
    'CLAUDE.md': 'Use npm.\n',
    '.claude/skills/deploy-helper/SKILL.md': '---\nname: deploy-helper\n---\nBody\n',
  });
  const report = await analyze({ cwd: root });
  const problems = buildProblems(report);
  expect(problems.length).toBeGreaterThan(0);
  for (const p of problems) expect(p.tools.length, p.title).toBeGreaterThan(0);
  const data = buildPageData(report);
  for (const a of data.agents) {
    const s = statusOf(data.problems, a.id);
    if (s.level !== 'ok') continue;
    // Fine means no cut-off and no thing to fix about this agent anywhere on the page.
    const mine = data.problems.filter((p) => p.level !== 'info' && p.tools.includes(a.id));
    expect(mine, a.label).toEqual([]);
    expect([...a.notes, ...a.warnings].join('\n')).not.toMatch(/no description/);
  }
  // The skill without a description is in the problem list once, not also in the fine print.
  const fine = data.agents.flatMap((a) => a.warnings).join('\n');
  expect(fine).not.toContain('skill has no description');
});

test('a bad file the user can fix is a problem, a doc caveat stays in the fine print', async () => {
  const root = tmpRepo({
    '.git/': '',
    'CLAUDE.md': 'See @missing-file.md for more.\n',
  });
  const report = await analyze({ cwd: root, agents: ['claude'] });
  const problems = buildProblems(report);
  expect(
    problems.some((p) => p.code === 'file-problem' && p.title.includes('import not found')),
  ).toBe(true);
  expect(buildPageData(report).agents[0]?.warnings.join('\n')).not.toContain('import not found');
});

test('the terminal prints the summary and every fix before the tables, with one total', async () => {
  const report = await sample();
  const text = renderTerminal(report, { color: false });
  const at = (s: string) => text.indexOf(s);
  expect(at('Summary')).toBeGreaterThan(-1);
  const total = buildProblems(report).filter((p) => p.level !== 'info').length;
  const heading = `${total} ${total === 1 ? 'thing' : 'things'} to fix`;
  expect(at(heading)).toBeGreaterThan(at('Summary'));
  expect(at('How to fix:')).toBeGreaterThan(-1);
  expect(at('Agent ')).toBeGreaterThan(at(heading));
  expect(text).not.toMatch(/more below/);
  for (const line of reportSummary(report)) expect(text).toContain(line.text);
});

test('the page data and the terminal summary say the same', async () => {
  const report = await sample();
  const data = buildPageData(report);
  const html = renderHtml(report);
  expect(html).toContain('ctxsize-data');
  const fromData = insights({
    messages: data.messages,
    agents: data.agents.map((a) => ({
      id: a.id,
      label: a.label,
      startup: 0,
      est: true,
      pct: 0,
      cost: null,
    })),
    problems: data.problems,
  });
  const fromReport = reportSummary(report)[0];
  expect(fromReport?.text).toBe(fromData.verdict.text);
});
