// End-to-end: one realistic repo with files for all five agents, run through analyze().
// Checks what each agent loads, that totals add up, that output is portable and stable,
// and that the same AGENTS.md is shared across agents the way their docs say.
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import {
  AGENT_IDS,
  type AgentId,
  type AgentReport,
  type Load,
  type Report,
} from '../src/core/types.ts';
import { fakeHome, tmpRepo } from './helpers.ts';

const FILES: Record<string, string> = {
  '.git/': '',
  // Claude Code
  'CLAUDE.md': '# Project\n\nUse pnpm.\n\nSee @docs/style.md for style.\n',
  'docs/style.md': '# Style\n\nTwo-space indent. No default exports.\n',
  '.claude/rules/general.md': '# General\n\nWrite tests first.\n',
  '.claude/rules/ts.md': '---\npaths: src/**/*.ts\n---\n# TypeScript\n\nStrict mode only.\n',
  '.claude/skills/x/SKILL.md':
    '---\nname: x\ndescription: Does x things for the project.\n---\n# X\n\nBody of x.\n',
  'packages/web/CLAUDE.md': '# Web\n\nUse React.\n',
  // Shared AGENTS.md (Codex, Cursor, Copilot; Claude only without CLAUDE.md)
  'AGENTS.md': '# Agents\n\nRun npm test before committing.\n',
  'packages/api/AGENTS.md': '# API\n\nKeep handlers small.\n',
  'packages/api/src/index.ts': 'export const x = 1;\n',
  // Codex / Gemini skills
  '.agents/skills/y/SKILL.md':
    '---\nname: y\ndescription: Does y things across agents.\n---\n# Y\n\nBody of y.\n',
  // Cursor
  '.cursor/rules/always.mdc': '---\nalwaysApply: true\n---\nAlways be kind.\n',
  '.cursor/rules/globs.mdc': '---\nglobs: src/**/*.ts\nalwaysApply: false\n---\nTS rule.\n',
  '.cursor/rules/agent.mdc':
    '---\ndescription: Use when touching the database\nalwaysApply: false\n---\nDB rule.\n',
  '.cursor/rules/manual.mdc': '---\nalwaysApply: false\n---\nManual rule.\n',
  '.cursor/rules/notes.md': 'Not a rule: wrong extension.\n',
  // Copilot
  '.github/copilot-instructions.md': '# Copilot\n\nPrefer small PRs.\n',
  '.github/instructions/all.instructions.md': '---\napplyTo: "**"\n---\nApplies everywhere.\n',
  '.github/instructions/ts.instructions.md': '---\napplyTo: "src/**/*.ts"\n---\nTS only.\n',
  '.github/instructions/excluded.instructions.md':
    '---\napplyTo: "**"\nexcludeAgent: cloud-agent\n---\nNot for the cloud agent.\n',
  '.github/instructions/noapply.instructions.md':
    '---\ndescription: nothing\n---\nNever applied.\n',
  // Gemini: also reads AGENTS.md via settings
  'GEMINI.md': '# Gemini\n\nSee @docs/gemini-extra.md\n',
  'docs/gemini-extra.md': 'Gemini extra notes.\n',
  '.gemini/settings.json': JSON.stringify({ context: { fileName: ['GEMINI.md', 'AGENTS.md'] } }),
  '.gemini/skills/z/SKILL.md': '---\nname: z\ndescription: Gemini-only skill z.\n---\nBody z.\n',
};

type Expected = Record<Load, string[]>;

function byLoad(a: AgentReport): Expected {
  const out: Expected = { startup: [], 'on-demand': [], ignored: [] };
  for (const item of a.items) out[item.load].push(item.path);
  for (const k of Object.keys(out) as Load[]) out[k].sort();
  return out;
}

function agent(report: Report, id: AgentId): AgentReport {
  const a = report.agents.find((r) => r.agent === id);
  if (!a) throw new Error(`no report for ${id}`);
  return a;
}

const sorted = (xs: string[]) => [...xs].sort();

/** Every place a path can show up in a report. */
function allPaths(report: Report): string[] {
  const out: string[] = [];
  for (const a of report.agents) {
    for (const i of a.items) {
      out.push(i.path);
      if (i.importedFrom) out.push(i.importedFrom);
      if (i.skill) out.push(i.skill.bodyPath);
    }
    for (const d of a.drops) if (d.path) out.push(d.path);
    for (const w of a.warnings) if (w.path) out.push(w.path);
  }
  return out;
}

function expectPortable(report: Report, repo: string): void {
  const json = JSON.stringify(report);
  // A literal backslash in the data shows up as "\\\\" in JSON; text uses only \n escapes.
  expect(json).not.toContain('\\\\');
  expect(json).not.toContain(repo);
  expect(json).not.toContain(repo.split(path.sep).join('/'));
  expect(json).not.toContain(path.basename(repo));
  expect(json).not.toMatch(/[A-Za-z]:[\\/]/);
  for (const p of allPaths(report)) {
    expect(p, p).not.toContain('\\');
    expect(p.startsWith('/'), p).toBe(false);
    expect(p.split('/'), p).not.toContain('..');
  }
}

function expectTotalsAddUp(report: Report): void {
  for (const a of report.agents) {
    const startup = a.items.filter((i) => i.load === 'startup');
    const sum = startup.reduce((s, i) => s + i.tokens, 0);
    expect(a.startup.total, a.agent).toBe(sum);
    const cats = Object.values(a.startup.byCategory).reduce((s, n) => s + n, 0);
    expect(cats, a.agent).toBe(sum);
    for (const c of Object.keys(a.startup.byCategory) as (keyof typeof a.startup.byCategory)[]) {
      const catSum = startup.filter((i) => i.category === c).reduce((s, i) => s + i.tokens, 0);
      expect(a.startup.byCategory[c], `${a.agent}/${c}`).toBe(catSum);
    }
    const onDemand = a.items.filter((i) => i.load === 'on-demand');
    expect(a.onDemand.count, a.agent).toBe(onDemand.length);
    expect(a.onDemand.total, a.agent).toBe(onDemand.reduce((s, i) => s + i.tokens, 0));
    for (const i of a.items) {
      expect(i.agent).toBe(a.agent);
      expect(i.bytes, i.path).toBe(Buffer.byteLength(i.text, 'utf8'));
      expect(i.scope, i.path).toBe('project');
    }
  }
}

describe('realistic repo, all agents, from the root', () => {
  test('each agent loads exactly the documented files', async () => {
    const repo = tmpRepo(FILES);
    const report = await analyze({ cwd: repo, agents: AGENT_IDS });
    expect(report.agents.map((a) => a.agent)).toEqual([...AGENT_IDS]);

    expect(byLoad(agent(report, 'claude'))).toEqual({
      startup: sorted([
        'CLAUDE.md',
        'docs/style.md',
        '.claude/rules/general.md',
        '.claude/skills/x/SKILL.md',
      ]),
      'on-demand': sorted(['.claude/rules/ts.md', 'packages/web/CLAUDE.md']),
      ignored: ['AGENTS.md'],
    });
    const style = agent(report, 'claude').items.find((i) => i.path === 'docs/style.md');
    expect(style?.importedFrom).toBe('CLAUDE.md');

    expect(byLoad(agent(report, 'codex'))).toEqual({
      startup: sorted(['AGENTS.md', '.agents/skills/y/SKILL.md']),
      'on-demand': [],
      ignored: [],
    });

    expect(byLoad(agent(report, 'cursor'))).toEqual({
      startup: sorted(['AGENTS.md', '.cursor/rules/always.mdc']),
      'on-demand': sorted([
        '.cursor/rules/agent.mdc',
        '.cursor/rules/globs.mdc',
        '.cursor/rules/manual.mdc',
        'packages/api/AGENTS.md',
      ]),
      ignored: ['.cursor/rules/notes.md'],
    });

    expect(byLoad(agent(report, 'copilot'))).toEqual({
      startup: sorted([
        '.github/copilot-instructions.md',
        'AGENTS.md',
        'CLAUDE.md',
        'GEMINI.md',
        '.github/instructions/all.instructions.md',
      ]),
      'on-demand': sorted(['.github/instructions/ts.instructions.md', 'packages/api/AGENTS.md']),
      ignored: sorted([
        '.github/instructions/excluded.instructions.md',
        '.github/instructions/noapply.instructions.md',
      ]),
    });

    expect(byLoad(agent(report, 'gemini'))).toEqual({
      startup: sorted([
        'GEMINI.md',
        'AGENTS.md',
        'docs/gemini-extra.md',
        '.agents/skills/y/SKILL.md',
        '.gemini/skills/z/SKILL.md',
      ]),
      'on-demand': ['packages/api/AGENTS.md'],
      ignored: [],
    });

    expectTotalsAddUp(report);
    expectPortable(report, repo);
    for (const a of report.agents) {
      // Copilot flags the undocumented CLAUDE.md/GEMINI.md + AGENTS.md combination.
      const expected = a.agent === 'copilot' ? ['CLAUDE.md', 'GEMINI.md'] : [];
      expect(
        a.warnings.map((w) => w.path),
        a.agent,
      ).toEqual(expected);
    }
  });

  test('analyze twice gives identical JSON', async () => {
    const repo = tmpRepo(FILES);
    const a = JSON.stringify(await analyze({ cwd: repo, agents: AGENT_IDS }));
    const b = JSON.stringify(await analyze({ cwd: repo, agents: AGENT_IDS }));
    expect(b).toBe(a);
  });

  test('two copies of the repo in different temp dirs give identical JSON', async () => {
    const a = JSON.stringify(await analyze({ cwd: tmpRepo(FILES), agents: AGENT_IDS }));
    const b = JSON.stringify(await analyze({ cwd: tmpRepo(FILES), agents: AGENT_IDS }));
    expect(b).toBe(a);
  });
});

describe('realistic repo, all agents, from packages/api', () => {
  test('each agent loads exactly the documented files', async () => {
    const repo = tmpRepo(FILES);
    const cwd = path.join(repo, 'packages', 'api');
    const report = await analyze({ cwd, agents: AGENT_IDS });

    // Root CLAUDE.md is an ancestor: still loads; AGENTS.md files are ignored next to it.
    expect(byLoad(agent(report, 'claude'))).toEqual({
      startup: sorted([
        'CLAUDE.md',
        'docs/style.md',
        '.claude/rules/general.md',
        '.claude/skills/x/SKILL.md',
      ]),
      'on-demand': ['.claude/rules/ts.md'],
      ignored: sorted(['AGENTS.md', 'packages/api/AGENTS.md']),
    });

    // Codex concatenates root to cwd.
    const codex = agent(report, 'codex');
    expect(byLoad(codex)).toEqual({
      startup: sorted(['AGENTS.md', 'packages/api/AGENTS.md', '.agents/skills/y/SKILL.md']),
      'on-demand': [],
      ignored: [],
    });
    const codexDocs = codex.items.filter((i) => i.category === 'instructions').map((i) => i.path);
    expect(codexDocs).toEqual(['AGENTS.md', 'packages/api/AGENTS.md']);

    // Cursor: every AGENTS.md from root down to cwd is in context.
    expect(byLoad(agent(report, 'cursor'))).toEqual({
      startup: sorted(['AGENTS.md', 'packages/api/AGENTS.md', '.cursor/rules/always.mdc']),
      'on-demand': sorted([
        '.cursor/rules/agent.mdc',
        '.cursor/rules/globs.mdc',
        '.cursor/rules/manual.mdc',
      ]),
      ignored: ['.cursor/rules/notes.md'],
    });

    // Copilot: nearest AGENTS.md wins, the root one is shadowed.
    expect(byLoad(agent(report, 'copilot'))).toEqual({
      startup: sorted([
        '.github/copilot-instructions.md',
        'packages/api/AGENTS.md',
        'CLAUDE.md',
        'GEMINI.md',
        '.github/instructions/all.instructions.md',
      ]),
      'on-demand': ['.github/instructions/ts.instructions.md'],
      ignored: sorted([
        'AGENTS.md',
        '.github/instructions/excluded.instructions.md',
        '.github/instructions/noapply.instructions.md',
      ]),
    });

    expect(byLoad(agent(report, 'gemini'))).toEqual({
      startup: sorted([
        'GEMINI.md',
        'AGENTS.md',
        'packages/api/AGENTS.md',
        'docs/gemini-extra.md',
        '.agents/skills/y/SKILL.md',
        '.gemini/skills/z/SKILL.md',
      ]),
      'on-demand': [],
      ignored: [],
    });

    expectTotalsAddUp(report);
    expectPortable(report, repo);
    const again = await analyze({ cwd, agents: AGENT_IDS });
    expect(JSON.stringify(again)).toBe(JSON.stringify(report));
  });
});

describe('cross-agent consistency of AGENTS.md', () => {
  const find = (a: AgentReport, p: string) => a.items.find((i) => i.path === p);

  test('codex, cursor, copilot and gemini read the same AGENTS.md with the same cost', async () => {
    const report = await analyze({ cwd: tmpRepo(FILES), agents: AGENT_IDS });
    const readers: AgentId[] = ['codex', 'cursor', 'copilot', 'gemini'];
    const items = readers.map((id) => find(agent(report, id), 'AGENTS.md'));
    for (const [n, item] of items.entries()) {
      expect(item?.load, readers[n]).toBe('startup');
      expect(item?.text).toBe(FILES['AGENTS.md']);
      expect(item?.bytes).toBe(items[0]?.bytes);
      expect(item?.tokens).toBe(items[0]?.tokens);
    }
    // Claude sees CLAUDE.md, so the AGENTS.md next to it is never read.
    expect(find(agent(report, 'claude'), 'AGENTS.md')?.load).toBe('ignored');
  });

  test('claude falls back to the same AGENTS.md only when there is no CLAUDE.md', async () => {
    const files = { ...FILES };
    delete files['CLAUDE.md'];
    const report = await analyze({ cwd: tmpRepo(files), agents: AGENT_IDS });
    const claude = find(agent(report, 'claude'), 'AGENTS.md');
    const codex = find(agent(report, 'codex'), 'AGENTS.md');
    expect(claude?.load).toBe('startup');
    expect(claude?.tokens).toBe(codex?.tokens);
    expect(claude?.text).toBe(codex?.text);
    // Nothing imported docs/style.md any more.
    expect(find(agent(report, 'claude'), 'docs/style.md')).toBeUndefined();
    // Copilot no longer gets a root CLAUDE.md either.
    expect(find(agent(report, 'copilot'), 'CLAUDE.md')).toBeUndefined();
  });

  test('CLAUDE.md that imports @AGENTS.md pulls in the same file the other agents read', async () => {
    const files = { ...FILES, 'CLAUDE.md': '@AGENTS.md\n' };
    const report = await analyze({ cwd: tmpRepo(files), agents: AGENT_IDS });
    const claude = find(agent(report, 'claude'), 'AGENTS.md');
    expect(claude?.load).toBe('startup');
    expect(claude?.importedFrom).toBe('CLAUDE.md');
    expect(claude?.tokens).toBe(find(agent(report, 'codex'), 'AGENTS.md')?.tokens);
    // Counted once, not again as "ignored".
    expect(agent(report, 'claude').items.filter((i) => i.path === 'AGENTS.md')).toHaveLength(1);
  });

  test('a .claude/CLAUDE.md alone also stops the AGENTS.md fallback', async () => {
    const files: Record<string, string> = { ...FILES, '.claude/CLAUDE.md': '# Hidden claude\n' };
    delete files['CLAUDE.md'];
    const report = await analyze({ cwd: tmpRepo(files), agents: ['claude'] });
    const claude = agent(report, 'claude');
    expect(find(claude, '.claude/CLAUDE.md')?.load).toBe('startup');
    expect(find(claude, 'AGENTS.md')?.load).toBe('ignored');
  });
});

describe('simulator through analyze', () => {
  test('40 KiB of AGENTS.md across root and subdir: codex truncates the file that crosses 32 KiB', async () => {
    const line = 'Always run the full test suite before you push any change.\n'; // 59 bytes
    const fill = (bytes: number) => line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes);
    const rootText = fill(24 * 1024);
    const subText = fill(16 * 1024);
    const repo = tmpRepo({ '.git/': '', 'AGENTS.md': rootText, 'pkg/AGENTS.md': subText });
    const report = await analyze({ cwd: path.join(repo, 'pkg'), agents: AGENT_IDS });

    const codex = agent(report, 'codex');
    expect(codex.drops).toHaveLength(1);
    expect(codex.drops[0]).toMatchObject({
      agent: 'codex',
      kind: 'file-truncated',
      certainty: 'will',
      path: 'pkg/AGENTS.md',
      bytesLost: 8 * 1024,
      limit: 'codex.projectDocMaxBytes',
    });
    const root = codex.items.find((i) => i.path === 'AGENTS.md');
    const sub = codex.items.find((i) => i.path === 'pkg/AGENTS.md');
    expect(root?.bytes).toBe(24 * 1024);
    expect(sub?.bytes).toBe(8 * 1024);
    expect(sub?.load).toBe('startup');
    expect((root?.bytes ?? 0) + (sub?.bytes ?? 0)).toBe(32 * 1024);
    expectTotalsAddUp(report);

    // Cursor and Copilot have no such limit and keep the file whole.
    for (const id of ['cursor', 'copilot'] as const) {
      const a = agent(report, id);
      expect(a.items.find((i) => i.path === 'pkg/AGENTS.md')?.bytes, id).toBe(16 * 1024);
      expect(a.drops, id).toEqual([]);
    }
  });

  test('a third AGENTS.md past the limit is dropped, not just truncated', async () => {
    const big = 'x'.repeat(20 * 1024);
    const repo = tmpRepo({
      '.git/': '',
      'AGENTS.md': big,
      'a/AGENTS.md': big,
      'a/b/AGENTS.md': 'small\n',
    });
    const codex = agent(
      await analyze({ cwd: path.join(repo, 'a', 'b'), agents: ['codex'] }),
      'codex',
    );
    expect(codex.drops.map((d) => [d.kind, d.path])).toEqual([
      ['file-truncated', 'a/AGENTS.md'],
      ['file-dropped', 'a/b/AGENTS.md'],
    ]);
    expect(codex.items.find((i) => i.path === 'a/b/AGENTS.md')?.load).toBe('ignored');
    expectTotalsAddUp({ agents: [codex] } as Report);
  });

  test('120 Claude skills with long descriptions: listing over budget is reported as at-risk', async () => {
    const files: Record<string, string> = { '.git/': '' };
    const desc = (n: number) =>
      `Skill number ${n} handles a very specific workflow in this repository, including setup, ` +
      'validation, migration, rollback, reporting and every edge case the team has hit so far.';
    for (let n = 0; n < 120; n++) {
      const name = `skill-${String(n).padStart(3, '0')}`;
      files[`.claude/skills/${name}/SKILL.md`] =
        `---\nname: ${name}\ndescription: ${desc(n)}\n---\n# ${name}\n\nBody.\n`;
    }
    // One description past the per-skill cap as well.
    files['.claude/skills/skill-000/SKILL.md'] =
      `---\nname: skill-000\ndescription: ${'long '.repeat(400)}\n---\nBody.\n`;
    const report = await analyze({ cwd: tmpRepo(files), agents: ['claude'] });
    const claude = agent(report, 'claude');

    expect(claude.items.filter((i) => i.category === 'skills')).toHaveLength(120);
    const note = claude.notes.find((n) => n.startsWith('Skill listing is'));
    expect(note).toBeDefined();
    expect(note).toContain('of 120 skill descriptions will be dropped');
    expect(note).toContain('1% of 200,000 context');
    const atRisk = claude.drops.filter((d) => d.kind === 'skill-description-dropped');
    expect(atRisk).toHaveLength(120);
    for (const d of atRisk) expect(d.certainty).toBe('at-risk');
    const truncated = claude.drops.filter((d) => d.kind === 'skill-description-truncated');
    expect(truncated.map((d) => d.skill)).toEqual(['skill-000']);
    expect(truncated[0]?.certainty).toBe('will');
    // at-risk drops only report; items stay in the startup total.
    expect(claude.items.every((i) => i.load === 'startup')).toBe(true);
    expectTotalsAddUp(report);
  });

  test('a handful of short skills stays under budget: no note, no drops', async () => {
    const repo = tmpRepo({
      '.git/': '',
      '.claude/skills/a/SKILL.md': '---\nname: a\ndescription: Short.\n---\n',
      '.claude/skills/b/SKILL.md': '---\nname: b\ndescription: Short too.\n---\n',
    });
    const claude = agent(await analyze({ cwd: repo, agents: ['claude'] }), 'claude');
    expect(claude.notes).toEqual([]);
    expect(claude.drops).toEqual([]);
  });
});

// An @import that points outside the repo must not leak an absolute machine path into the
// report (monorepos: CLAUDE.md with @../shared.md).
test('an import outside the repo never shows an absolute path', async () => {
  const outer = tmpRepo({
    'shared.md': 'shared rules\n',
    'repo/.git/': '',
    'repo/CLAUDE.md': '# Repo\n\n@../shared.md\n',
  });
  const report = await analyze({ cwd: path.join(outer, 'repo'), agents: ['claude', 'gemini'] });
  const json = JSON.stringify(report);
  expect(json).not.toContain(path.basename(outer));
  for (const a of report.agents) {
    for (const i of a.items)
      expect(path.posix.isAbsolute(i.path) || /^[A-Za-z]:/.test(i.path)).toBe(false);
  }
});

// Codex's global ~/.codex/AGENTS.md is joined after the project docs and does not use up the
// 32 KiB project_doc_max_bytes budget.
test('global ~/.codex/AGENTS.md does not eat the project AGENTS.md budget', async () => {
  const home = fakeHome({ '.codex/AGENTS.md': 'g'.repeat(30 * 1024) });
  const repo = tmpRepo({ '.git/': '', 'AGENTS.md': 'p'.repeat(10 * 1024) });
  const [codex] = (await analyze({ cwd: repo, agents: ['codex'], home })).agents;
  expect(codex?.drops).toEqual([]);
  expect(codex?.items.find((i) => i.path === 'AGENTS.md')?.bytes).toBe(10 * 1024);
});
