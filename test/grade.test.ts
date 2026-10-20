import { expect, test, vi } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { toJson } from '../src/report/json.ts';
import { renderMarkdown } from '../src/report/share.ts';
import {
  buildProblems,
  gradeOf,
  insights,
  type Problem,
  reportGrades,
} from '../src/report/summary.ts';
import { renderTerminal } from '../src/report/terminal.ts';
import { EXIT, run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

vi.setConfig({ testTimeout: 30_000 });

const problem = (level: Problem['level'], tools = ['a']): Problem => ({
  level,
  code: 'c',
  title: 't',
  short: 's',
  fix: 'f',
  tools,
  paths: [],
});

test('no problems is an A, tips do not count', () => {
  expect(gradeOf([], ['a'])).toEqual({ letter: 'A', score: 100, bad: 0, warn: 0 });
  expect(gradeOf([problem('info')], ['a']).letter).toBe('A');
});

test('one thing to fix is never an A', () => {
  expect(gradeOf([problem('warn')], ['a'])).toMatchObject({ letter: 'B', score: 95 });
});

test('the letter follows the score: 80 B, 60 C, 40 D, below F', () => {
  const warns = (n: number) => Array.from({ length: n }, () => problem('warn'));
  expect(gradeOf(warns(4), ['a']).letter).toBe('B');
  expect(gradeOf(warns(5), ['a']).letter).toBe('C');
  expect(gradeOf(warns(8), ['a']).letter).toBe('C');
  expect(gradeOf(warns(9), ['a']).letter).toBe('D');
  expect(gradeOf(warns(12), ['a']).letter).toBe('D');
  expect(gradeOf(warns(13), ['a']).letter).toBe('F');
  expect(gradeOf(warns(40), ['a']).score).toBe(0);
});

test('anything cut off caps the grade at C', () => {
  expect(gradeOf([problem('bad')], ['a'])).toMatchObject({ letter: 'C', score: 85, bad: 1 });
  expect(gradeOf([problem('bad'), problem('bad'), problem('bad')], ['a']).letter).toBe('D');
});

test('only the problems of the asked agents count', () => {
  const list = [problem('bad', ['b']), problem('warn', ['a'])];
  expect(gradeOf(list, ['a']).letter).toBe('B');
  expect(gradeOf(list, ['b']).letter).toBe('C');
  expect(gradeOf(list, ['a', 'b']).bad).toBe(1);
});

test('the grade agrees with the fix list: A exactly when nothing needs fixing', async () => {
  const repos: Record<string, string>[] = [
    {},
    { 'AGENTS.md': '# Rules\n\nUse npm.\n' },
    { 'AGENTS.md': '# R\n', 'CLAUDE.md': '# R\n' },
    { 'AGENTS.md': `# Big\n\n${'Use npm and run every test twice. '.repeat(2000)}\n` },
    { '.claude/skills/x/SKILL.md': '---\nname: x\n---\nBody\n' },
  ];
  for (const files of repos) {
    const dir = tmpRepo({ '.git/': '', ...files });
    const report = await analyze({ cwd: dir, root: dir });
    const agents = report.agents
      .filter((a) => a.startup.total > 0)
      .map((a) => ({
        id: a.agent,
        label: a.label,
        startup: a.startup.total,
        est: true,
        pct: a.usage.startupPctOfContext,
        cost: null,
      }));
    const i = insights({ messages: 80, agents, problems: buildProblems(report) });
    if (!i.grade) continue;
    expect(i.grade.letter === 'A').toBe(i.toFix === 0);
    expect(i.grade.bad).toBe(i.cutOff);
    if (i.cutOff > 0) expect(['C', 'D', 'F']).toContain(i.grade.letter);
  }
});

test('an agent that starts with a fifth of its window used has a problem to fix', async () => {
  const dir = tmpRepo({
    '.git/': '',
    'AGENTS.md': `${'Use npm and run every test twice. '.repeat(2400)}\n`,
  });
  const report = await analyze({ cwd: dir, root: dir, contextTokens: 20_000 });
  const heavy = buildProblems(report).filter((p) => p.code === 'startup-heavy');
  expect(heavy.length).toBeGreaterThan(0);
  expect(reportGrades(report).overall?.letter).not.toBe('A');
});

test('the grade shows in the terminal, JSON and Markdown', async () => {
  const dir = tmpRepo({ '.git/': '', 'AGENTS.md': '# Rules\n\nUse npm.\n' });
  const report = await analyze({ cwd: dir, root: dir });
  const grades = reportGrades(report);
  expect(grades.overall?.letter).toBe('A');
  expect(renderTerminal(report, { color: false, sort: undefined, top: undefined })).toContain(
    'Context health: A (100/100)',
  );
  const json = JSON.parse(toJson(report));
  expect(json.grade.overall.letter).toBe('A');
  expect(Object.keys(json.grade.agents).length).toBeGreaterThan(0);
  const md = renderMarkdown(report);
  expect(md).toContain('**Context health: A**');
  expect(md).toContain('| Grade |');
});

test('a repo that loads nothing has no grade', async () => {
  const dir = tmpRepo({ '.git/': '' });
  const report = await analyze({ cwd: dir, root: dir });
  report.agents = [];
  expect(reportGrades(report).overall).toBeNull();
  expect(EXIT.ok).toBe(0);
  expect(run).toBeTypeOf('function');
});
