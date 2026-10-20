import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { renderHtml } from '../src/report/html.ts';
import { buildProblems, insights, reportSummary, savingFor } from '../src/report/summary.ts';
import { renderTerminal } from '../src/report/terminal.ts';
import { tmpRepo } from './helpers.ts';
import { runPage } from './page-helper.ts';

vi.setConfig({ testTimeout: 30_000 });

const RUNBOOK = `## Deploying to production\n\n${Array.from(
  { length: 120 },
  (_, i) =>
    `Step detail ${i}: run the staging script, wait, then verify the dashboard shows green.`,
).join('\n')}\n`;
const SHARED =
  'Always run the full test suite before you push, and never skip a failing test by commenting it out. Keep every pull request small, focused and described in plain words for the reviewer.';

const DUPLICATES = ['duplicate-file', 'near-identical-files', 'duplicate-paragraphs'];

async function repoWithSavings(price?: { amount: number; per: number; currency: string }) {
  const root = tmpRepo({
    '.git/': '',
    'AGENTS.md': `# Agents\n\n${SHARED}\n\nUse npm for every script in this repository.\n`,
    'CLAUDE.md': `# Claude\n\n${SHARED}\n\nUse npm for every script in this repository.\n\n${RUNBOOK}`,
    '.claude/skills/nodesc/SKILL.md': '---\nname: nodesc\n---\nBody\n',
  });
  return analyze({
    cwd: path.join(root),
    agents: ['claude', 'copilot', 'codex'],
    ...(price ? { price } : {}),
  });
}

describe('tokens saved per message', () => {
  test('a section that could be a skill saves the tokens of that section, for the agents that load it', async () => {
    const report = await repoWithSavings();
    const problems = buildProblems(report);
    const move = problems.find((p) => p.code === 'move-to-skill');
    expect(move?.saves).toBeGreaterThan(800);
    expect(move?.level).toBe('info');
    expect(savingFor(problems, 'claude')).toBeGreaterThanOrEqual(move?.saves ?? Infinity);
  });

  test('text an agent loads twice saves the duplicated tokens; a fix we cannot count claims nothing', async () => {
    const report = await repoWithSavings();
    const problems = buildProblems(report);
    const dup = problems.find((p) => DUPLICATES.includes(p.code));
    expect(dup?.tools).toContain('copilot');
    expect(dup?.saves).toBeGreaterThan(20);
    const noDescription = problems.find((p) => p.code === 'skill-no-description');
    expect(noDescription).toBeDefined();
    expect(noDescription?.saves).toBeUndefined();
    for (const p of problems.filter((x) => ['legacy', 'file-truncated'].includes(x.code))) {
      expect(p.saves, p.code).toBeUndefined();
    }
  });

  test('a duplicate that no agent loads together is untidy but not paid for twice, so it saves nothing', async () => {
    const root = tmpRepo({
      '.git/': '',
      'AGENTS.md': `# A\n\n${SHARED}\n`,
      'CLAUDE.md': `# B\n\n${SHARED}\n`,
    });
    const report = await analyze({ cwd: path.join(root), agents: ['claude', 'codex'] });
    for (const p of buildProblems(report).filter((x) => x.code.startsWith('duplicate'))) {
      expect(p.saves, p.code).toBeUndefined();
    }
  });

  test('the Overview line counts only the top items, and only what can be counted', async () => {
    const report = await repoWithSavings();
    const problems = buildProblems(report);
    const agents = report.agents.map((a) => ({
      id: a.agent,
      label: a.label,
      startup: a.startup.total,
      est: true,
      pct: 1,
      cost: null,
    }));
    const i = insights({ messages: 50, agents, problems });
    const top = i.fixFirst.reduce((n, p) => n + (p.saves ?? 0), 0);
    if (top === 0) expect(i.saves).toBeNull();
    else expect(i.saves?.tokens).toBeGreaterThan(0);
    // With only the duplicate to fix, it is that duplicate's saving, for the agent that loads both.
    const dup = problems.filter((p) => DUPLICATES.includes(p.code));
    const only = insights({ messages: 50, agents, problems: dup });
    expect(only.saves).toEqual({ tokens: dup[0]?.saves, agent: 'GitHub Copilot' });
    // Nothing countable, nothing claimed.
    expect(insights({ messages: 50, agents, problems: [] }).saves).toBeNull();
  });

  test('the terminal says how many tokens a fix saves, and the money only with your price', async () => {
    const report = await repoWithSavings();
    const plain = renderTerminal(report, { color: false });
    expect(plain).toMatch(/Saves ~[\d,]+ tokens per message\n/);
    expect(plain).not.toMatch(/Saves ~[\d,]+ tokens per message \(/);
    const priced = renderTerminal(
      await repoWithSavings({ amount: 250, per: 1_000_000, currency: '₹' }),
      {
        color: false,
      },
    );
    expect(priced).toMatch(/Saves ~[\d,]+ tokens per message \(₹[\d.]+ per message\)/);
    expect(reportSummary(report).length).toBeGreaterThan(0);
  });

  test('the Fix list shows the saving on each fix that has one, and not on the others', async () => {
    const report = await repoWithSavings();
    const page = runPage(renderHtml(report));
    const fixes = page('fixes');
    expect(fixes).toMatch(/class="psave">Saves ~[\d,]+ tokens per message/);
    const cards = fixes.split('<li class="').slice(1);
    const noDesc = cards.find((c) => c.includes('has no description'));
    expect(noDesc).toBeDefined();
    expect(noDesc).not.toContain('psave');
  });

  test('with a price entered, the saving also shows money per day and per month in that currency', async () => {
    const report = await repoWithSavings();
    const page = runPage(renderHtml(report));
    expect(page('fixes')).not.toMatch(/per day, /);
    page.pick('currencyKind', 0, '₹');
    page.type('amount', 0, '250');
    expect(page('fixes')).toMatch(
      /Saves ~[\d,]+ tokens per message \(₹[\d,.]+ per day, ₹[\d,.]+ per month\)/,
    );
    page.type('msgsDay', 0, '100');
    expect(page('fixes')).toMatch(/per day, /);
  });

  test('each agent says what its own fixes save', async () => {
    const report = await repoWithSavings();
    const page = runPage(renderHtml(report));
    page.click('open', 'copilot');
    expect(page('panel')).toMatch(
      /class="saves">[\s\S]*Doing the fixes below saves ~[\d,]+ tokens per message for GitHub Copilot/,
    );
    page.click('open', 'codex');
    expect(page('panel')).not.toContain('Doing the fixes below');
  });

  test('the Overview shows the saving when the top items have one', async () => {
    // Only a duplicate to fix: it is the top item.
    const root = tmpRepo({
      '.git/': '',
      'AGENTS.md': `# Agents\n\n${SHARED}\n\nUse npm for every script in this repository.\n`,
      'CLAUDE.md': `# Claude\n\n${SHARED}\n\nUse npm for every script in this repository.\n`,
    });
    const report = await analyze({ cwd: path.join(root), agents: ['copilot'] });
    const page = runPage(renderHtml(report));
    expect(page('first')).toMatch(
      /Fixing the top item saves ~[\d,]+ tokens per message for GitHub Copilot/,
    );
    // A repo whose top items have no countable saving shows no such line.
    const none = tmpRepo({ '.git/': '', '.cursorrules': 'old rules\n' });
    const noneReport = await analyze({ cwd: path.join(none), agents: ['cursor'] });
    expect(runPage(renderHtml(noneReport))('first')).not.toContain('saves ~');
  });
});
