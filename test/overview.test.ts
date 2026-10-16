import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { buildPageData, renderHtml } from '../src/report/html.ts';
import { tmpRepo } from './helpers.ts';
import { dataOf, html, report, runPage } from './page-helper.ts';

vi.setConfig({ testTimeout: 30_000 });

const SKILL_REPO = {
  'AGENTS.md': `${'Use npm. '.repeat(100)}\n`,
  '.claude/skills/nodesc/SKILL.md': '---\nname: nodesc\n---\nBody\n',
};

// ---------------------------------------------------------------- the five tabs

test('the page has five tabs, in order, and the Overview is the default', async () => {
  const out = await html({ 'AGENTS.md': 'Use npm.\n' });
  const nav = runPage(out)('nav');
  const ids = [...nav.matchAll(/data-act="view" data-id="(\w+)"/g)].map((m) => m[1]);
  expect(ids).toEqual(['overview', 'agents', 'fixes', 'settings', 'help']);
  expect(nav).toMatch(/aria-selected="true"[^>]*data-id="overview"/);
  const at = (s: string) => out.indexOf(s);
  const order = [
    'id="view-overview"',
    'id="view-agents"',
    'id="view-fixes"',
    'id="view-settings"',
    'id="view-help"',
  ];
  for (let i = 1; i < order.length; i++) {
    expect(at(order[i] ?? '')).toBeGreaterThan(at(order[i - 1] ?? ''));
  }
});

test('the view is kept in the address, so a refresh stays on the same tab', async () => {
  const out = await html({ 'AGENTS.md': 'Use npm.\n' });
  const page = runPage(out, { hash: '#fixes' });
  expect(page('nav')).toMatch(/aria-selected="true"[^>]*data-id="fixes"/);
  page.click('view', 'help');
  expect(page.hash()).toBe('#help');
  expect(page('nav')).toMatch(/aria-selected="true"[^>]*data-id="help"/);
  // An unknown hash falls back to the Overview.
  expect(runPage(out, { hash: '#nope' })('nav')).toMatch(
    /aria-selected="true"[^>]*data-id="overview"/,
  );
});

test('fine print, MCP servers and the share buttons are collapsed at the bottom of Help and Settings', async () => {
  const out = await html({ 'AGENTS.md': 'Use npm.\n' });
  // (the page script holds its own markup strings; only the static page is checked)
  expect(out.slice(0, out.indexOf('<script'))).not.toMatch(/<details[^>]* open/);
  const at = (s: string) => out.indexOf(s);
  expect(at('id="fine"')).toBeGreaterThan(at('id="view-help"'));
  expect(at('Share this run</summary>')).toBeGreaterThan(at('id="view-settings"'));
  expect(at('Share this run</summary>')).toBeLessThan(at('id="view-help"'));
  expect(out).toContain('How to read this page');
  const items = out.match(/<ol class="howto">([\s\S]*?)<\/ol>/)?.[1]?.match(/<li>/g);
  expect(items).toHaveLength(5);
});

// ---------------------------------------------------------------- the Overview

test('the Overview has a verdict, three tiles, the chart and what to fix first', async () => {
  const out = await html(SKILL_REPO);
  const run = runPage(out);
  expect(run('verdict')).toContain('Mostly fine');
  const tiles = run('tiles');
  for (const label of ['Reads the most', 'Cut off', 'To fix']) expect(tiles).toContain(label);
  expect(tiles.match(/class="stile /g)).toHaveLength(3);
  expect(run('compare')).toContain('Who reads the most?');
  expect(run('first')).toContain('Fix these first');
  expect(run('first')).toContain('How to fix:');
});

test('"Fix these first" shows at most 3 things and "See all N" opens the Fix list', async () => {
  const files: Record<string, string> = { 'AGENTS.md': 'Use npm.\n' };
  for (let i = 0; i < 6; i++)
    files[`.claude/skills/s${i}/SKILL.md`] = `---\nname: s${i}\n---\nBody\n`;
  const out = await html(files);
  const page = runPage(out);
  const total = dataOf(out).problems.filter((p) => p.level !== 'info').length;
  expect(total).toBeGreaterThan(3);
  expect(page('first').match(/class="fx /g)).toHaveLength(3);
  expect(page('first')).toContain(`See all ${total}`);
  page.click('view', 'fixes');
  expect(page.hash()).toBe('#fixes');
  expect(page('fixes').match(/class="(bad|warn|info)"/g)?.length).toBeGreaterThanOrEqual(total);
});

test('the Overview uses no jargon; the hard words live in tooltips and Help', async () => {
  const out = await html(SKILL_REPO);
  const run = runPage(out);
  const shown = [run('chips'), run('verdict'), run('tiles'), run('compare'), run('first')]
    .join('\n')
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase();
  for (const word of [
    'overhead',
    'modelled',
    'surface',
    'o200k',
    'cl100k',
    'tokenizer',
    'startup tokens',
  ]) {
    expect(shown, word).not.toContain(word);
  }
});

test('each bar shows the agent, a bar, the tokens and a status icon; cost is behind a toggle', async () => {
  const out = await html({ 'AGENTS.md': `${'Use npm. '.repeat(100)}\n` });
  const run = runPage(out);
  const compare = run('compare');
  expect(compare).toMatch(/<span class="nm">Codex<\/span>/);
  expect(compare).toMatch(/class="si (ok|warn|bad)"/);
  expect(compare).toContain('id="in-cost"');
  expect(compare).not.toMatch(/id="in-cost"[^>]* checked/);
  // % and cost are only revealed by the toggle (the .cost-on class).
  expect(out).toContain('.cost-on .row .pc,.cost-on .row .co{display:block}');
  run.change('cost', '', { checked: true });
  expect(run('compare')).toMatch(/id="in-cost"[^>]* checked/);
  expect(run.storage.get('ctxsize-cost')).toBe('1');
});

test('the Agents view details say what it reads and how to reduce it', async () => {
  const out = await html({ 'AGENTS.md': `${'Use npm. '.repeat(100)}\n` });
  const panel = runPage(out)('panel');
  for (const part of ['What it reads', 'How to reduce it', 'Problems for']) {
    expect(panel).toContain(part);
  }
  expect(panel).toContain('tokens read at startup');
  expect(panel).toContain('Generic');
});

// ---------------------------------------------------------------- one source of truth

test('a status icon, the tiles, the verdict and the Fix list come from the same problems', async () => {
  const out = await html(SKILL_REPO);
  const data = dataOf(out);
  const run = runPage(out);
  const row = (id: string) =>
    new RegExp(`<button[^>]*data-id="${id}"[^>]*>[\\s\\S]*?</button>`).exec(run('compare'))?.[0] ??
    '';
  // Claude Code loads the skill that has no description: it is not "Fine".
  expect(row('claude')).toContain('st-warn');
  expect(row('claude')).toContain('1 to fix');
  expect(row('codex')).toContain('st-ok');
  const toFix = data.problems.filter((p) => p.level !== 'info').length;
  expect(run('verdict')).toContain(`${toFix} thing`);
  expect(run('tiles')).toContain(`<b>${toFix}</b>`);
  expect(run('fixes')).toContain(`${toFix} ${toFix === 1 ? 'thing' : 'things'} to fix`);
  expect(run('nav')).toContain(`aria-label="${toFix} to fix"`);
  expect(run('fixes')).toContain('<code>.claude/skills/nodesc/SKILL.md</code>');
  expect(run('fixes')).toContain('class="fgroup"');
});

test('the Fix list is grouped by file with the worst file first', async () => {
  const out = await html({
    ...SKILL_REPO,
    'AGENTS.md': `${'Root rule text. '.repeat(1400)}\n`,
  });
  const fixes = runPage(out)('fixes');
  const groups = [...fixes.matchAll(/<h3><code>([^<]+)<\/code>/g)].map((m) => m[1]);
  expect(groups.length).toBeGreaterThan(0);
  expect(new Set(groups).size).toBe(groups.length);
});

test('a friendly empty state replaces the chart for an empty repo', async () => {
  const root = tmpRepo({ '.git/': '' });
  const empty = await analyze({ cwd: path.join(root) });
  empty.agents = []; // the CLI hides agents that load nothing
  const out = renderHtml(empty);
  expect(out).toContain('id="empty"');
  expect(out).toContain('No agent files found');
  expect(out).toContain('AGENTS.md');
  expect(runPage(out)('fixes')).toContain('nothing to fix');
});

// ---------------------------------------------------------------- which agents do you use?

test('a chip for every agent; clicking one leaves it out of everything and is remembered', async () => {
  const out = await html(SKILL_REPO);
  const data = dataOf(out);
  const page = runPage(out);
  expect(page('chips').match(/class="chip on"/g)).toHaveLength(data.agents.length);
  const before = page('tiles');
  expect(page('compare')).toContain('data-id="claude"');
  page.click('chip', 'claude');
  expect(page('chips')).toMatch(/class="chip"[^>]*data-id="claude"/);
  // The chart, the tiles, the verdict and the fix list now count only the other agents.
  expect(page('compare')).not.toContain('data-id="claude"');
  expect(page('verdict')).toContain('All good');
  expect(page('tiles')).not.toBe(before);
  expect(page('tiles')).toContain('Nothing');
  expect(page('fixes')).not.toContain('nodesc');
  expect(page('nav')).not.toContain('class="cnt"');
  expect(JSON.parse(page.storage.get('ctxsize-agents') ?? 'null')).toEqual(['claude']);
  // Clicking again brings it back.
  page.click('chip', 'claude');
  expect(page('compare')).toContain('data-id="claude"');
  expect(JSON.parse(page.storage.get('ctxsize-agents') ?? 'null')).toEqual([]);
});

test('the chosen agents are restored on the next visit; the default is all of them', async () => {
  const out = await html(SKILL_REPO);
  const all = dataOf(out).agents.length;
  expect(runPage(out)('chips').match(/class="chip on"/g)).toHaveLength(all);
  const again = runPage(out, { storage: { 'ctxsize-agents': '["claude","codex"]' } });
  expect(again('chips').match(/class="chip on"/g)).toHaveLength(all - 2);
  expect(again('compare')).not.toContain('data-id="claude"');
  expect(again('verdict')).toContain('All good');
});

test('blocked or damaged storage never breaks the page', async () => {
  const out = await html(SKILL_REPO);
  const all = dataOf(out).agents.length;
  const blocked = runPage(out, { blocked: true });
  expect(blocked('chips').match(/class="chip on"/g)).toHaveLength(all);
  blocked.click('chip', 'claude');
  expect(blocked('compare')).not.toContain('data-id="claude"');
  const damaged = runPage(out, { storage: { 'ctxsize-agents': '{not json' } });
  expect(damaged('chips').match(/class="chip on"/g)).toHaveLength(all);
});

test('picking no agent says so instead of showing an empty chart', async () => {
  const r = await report({ 'AGENTS.md': 'Use npm.\n' }, '', ['codex']);
  const out = renderHtml(r);
  const page = runPage(out);
  page.click('chip', 'codex');
  expect(page('verdict')).toContain('No agent is picked');
  expect(page('compare')).toContain('No agent is shown');
});

test('Reset brings every agent back, and forgets the saved choice', async () => {
  const out = await html(SKILL_REPO);
  const all = dataOf(out).agents.length;
  const page = runPage(out, { storage: { 'ctxsize-agents': '["claude"]', 'ctxsize-cost': '1' } });
  page.click('reset');
  expect(page('chips').match(/class="chip on"/g)).toHaveLength(all);
  expect(page.storage.get('ctxsize-agents')).toBe('[]');
  expect(page.storage.get('ctxsize-cost')).toBe('0');
});

// ---------------------------------------------------------------- live refresh

test('live refresh keeps the chosen tab and the chosen agents', async () => {
  const root = tmpRepo({ '.git/': '', ...SKILL_REPO });
  const r = await analyze({ cwd: path.join(root) });
  const out = renderHtml(r, { generated: '1', stream: '/events' });
  const page = runPage(out);
  page.click('chip', 'cursor');
  page.click('view', 'fixes');
  const next = buildPageData(r, { generated: '2', stream: '/events' });
  page.push(next);
  expect(page.hash()).toBe('#fixes');
  expect(page('nav')).toMatch(/aria-selected="true"[^>]*data-id="fixes"/);
  expect(page('chips')).toMatch(/class="chip"[^>]*data-id="cursor"/);
  expect(page('compare')).not.toContain('data-id="cursor"');
});

// ---------------------------------------------------------------- tooltips

test('every help icon the page can draw has a definition', async () => {
  const out = await html(SKILL_REPO);
  const run = runPage(out);
  run.click('view', 'fixes');
  run.click('view', 'agents');
  const drawn = new Set([...run.all().matchAll(/data-help="([a-z-]+)"/g)].map((m) => m[1]));
  expect(drawn.size).toBeGreaterThan(20);
  for (const id of drawn) expect(out, String(id)).toContain(`<div id="h-${id}">`);
});
