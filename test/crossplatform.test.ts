// Cross-platform: spaces and non-ASCII in file names, CRLF line endings, a BOM,
// wrong-case names and directories that share an instruction file's name.
// Reports must list the same files with POSIX relative paths on every OS.
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { AGENT_IDS, type AgentReport, type LoadedItem, type Report } from '../src/core/types.ts';
import { tmpRepo } from './helpers.ts';

const BOM = '﻿';

const FILES: Record<string, string> = {
  '.git/': '',
  'CLAUDE.md': '# Root\n\nRead @docs/my\\ style\\ é.md first.\n',
  'docs/my style é.md': '# Style é\n\nTabs, not spaces.\n',
  '.claude/rules/my rule é.md': '# Rule é\n\nAlways on.\n',
  '.claude/rules/日本 paths.md': '---\npaths: "src/**/*.ts"\n---\n# 日本\n\nOnly for TS.\n',
  '.claude/skills/日本 skill/SKILL.md': '---\ndescription: 日本語のスキル.\n---\nBody.\n',
  '.agents/skills/café/SKILL.md': '---\nname: café\ndescription: Makes coffee.\n---\nBody.\n',
  'AGENTS.md': '# Agents\n\nShared rules.\n',
  'packages/日本/AGENTS.md': '# 日本 package\n\nLocal rules.\n',
  'packages/my pkg/CLAUDE.md': '# My pkg\n\nOn demand.\n',
  // A directory with an instruction file's name: never a file to load.
  'packages/日本/CLAUDE.md/': '',
  'packages/日本/CLAUDE.md/inner.md': 'not an instruction file\n',
  // Wrong case: agents match names exactly, even on case-insensitive file systems.
  'packages/lower/agents.md': 'wrong case\n',
  'packages/lower/claude.md': 'wrong case\n',
  '.cursor/rules/日本 rule.mdc': '---\nalwaysApply: true\n---\nAlways 日本.\n',
  '.cursor/rules/glob é.mdc': '---\nglobs: "**/*.ts"\n---\nTS é.\n',
  '.github/copilot-instructions.md': '# Copilot\n\nBe brief.\n',
  '.github/instructions/café.instructions.md': '---\napplyTo: "**"\n---\nCafé everywhere.\n',
  'GEMINI.md': `${BOM}# Gemini\n\nWith a BOM.\n`,
};

const crlf = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.replaceAll('\n', '\r\n')]));

const key = (i: LoadedItem) => `${i.agent}|${i.path}|${i.load}|${i.category}`;

function expectPosix(report: Report, repo: string): void {
  // File text may hold backslashes (the escaped-space import does); everything else may not.
  const json = JSON.stringify(report, (k, v) => (k === 'text' ? undefined : v));
  expect(json).not.toContain('\\\\');
  expect(json).not.toContain(path.basename(repo));
  for (const a of report.agents) {
    for (const i of a.items) {
      const paths = [i.path, i.importedFrom, i.skill?.bodyPath].filter(
        (p): p is string => p !== undefined,
      );
      for (const p of paths) {
        expect(p, p).not.toContain('\\');
        expect(path.posix.isAbsolute(p), p).toBe(false);
        expect(p).not.toMatch(/^[A-Za-z]:/);
      }
    }
  }
}

function paths(a: AgentReport | undefined, load: LoadedItem['load']): string[] {
  return (a?.items ?? [])
    .filter((i) => i.load === load)
    .map((i) => i.path)
    .sort();
}

const get = (r: Report, id: string) => r.agents.find((a) => a.agent === id);

describe('unicode, spaces, BOM and look-alike names', () => {
  test('files load under their real names and paths are POSIX', async () => {
    const repo = tmpRepo(FILES);
    const report = await analyze({ cwd: repo, agents: AGENT_IDS });
    expectPosix(report, repo);

    const claude = get(report, 'claude');
    expect(paths(claude, 'startup')).toEqual(
      [
        'CLAUDE.md',
        'docs/my style é.md',
        '.claude/rules/my rule é.md',
        '.claude/skills/日本 skill/SKILL.md',
      ].sort(),
    );
    expect(paths(claude, 'on-demand')).toEqual(
      ['.claude/rules/日本 paths.md', 'packages/my pkg/CLAUDE.md'].sort(),
    );
    const skill = claude?.items.find((i) => i.category === 'skills');
    expect(skill?.skill?.name).toBe('日本 skill');
    expect(skill?.skill?.bodyPath).toBe('.claude/skills/日本 skill/SKILL.md');

    expect(paths(get(report, 'codex'), 'startup')).toEqual(
      ['AGENTS.md', '.agents/skills/café/SKILL.md'].sort(),
    );
    expect(paths(get(report, 'cursor'), 'startup')).toEqual(
      ['AGENTS.md', '.cursor/rules/日本 rule.mdc'].sort(),
    );
    expect(paths(get(report, 'cursor'), 'on-demand')).toEqual(
      ['.cursor/rules/glob é.mdc', 'packages/日本/AGENTS.md'].sort(),
    );
    expect(paths(get(report, 'copilot'), 'startup')).toEqual(
      [
        '.github/copilot-instructions.md',
        'AGENTS.md',
        'CLAUDE.md',
        'GEMINI.md',
        '.github/instructions/café.instructions.md',
      ].sort(),
    );

    // BOM is stripped before counting.
    const gemini = get(report, 'gemini')?.items.find((i) => i.path === 'GEMINI.md');
    expect(gemini?.text.startsWith(BOM)).toBe(false);
    expect(gemini?.bytes).toBe(Buffer.byteLength('# Gemini\n\nWith a BOM.\n'));

    // Nothing anywhere picks up the CLAUDE.md directory or the wrong-case files.
    const all = report.agents.flatMap((a) => a.items.map((i) => i.path));
    expect(all.filter((p) => p.startsWith('packages/日本/CLAUDE.md'))).toEqual([]);
    expect(all.filter((p) => p.startsWith('packages/lower/'))).toEqual([]);
  });

  test('works from a cwd whose name has spaces and non-ASCII', async () => {
    const repo = tmpRepo(FILES);
    const report = await analyze({ cwd: path.join(repo, 'packages', '日本'), agents: AGENT_IDS });
    expectPosix(report, repo);
    expect(paths(get(report, 'codex'), 'startup')).toContain('packages/日本/AGENTS.md');
    expect(paths(get(report, 'copilot'), 'startup')).toContain('packages/日本/AGENTS.md');
    expect(paths(get(report, 'copilot'), 'ignored')).toContain('AGENTS.md');
    const spaced = await analyze({
      cwd: path.join(repo, 'packages', 'my pkg'),
      agents: ['claude'],
    });
    expect(paths(get(spaced, 'claude'), 'startup')).toContain('packages/my pkg/CLAUDE.md');
    expectPosix(spaced, repo);
  });

  test('a directory named CLAUDE.md or GEMINI.md at the root is not an instruction file', async () => {
    const repo = tmpRepo({
      '.git/': '',
      'CLAUDE.md/': '',
      'CLAUDE.md/notes.md': 'x\n',
      'GEMINI.md/': '',
      'AGENTS.md': '# Agents\n',
    });
    const report = await analyze({ cwd: repo, agents: AGENT_IDS });
    const all = report.agents.flatMap((a) => a.items.map((i) => `${i.agent}:${i.path}`));
    expect(all.filter((p) => p.includes('CLAUDE.md') || p.includes('GEMINI.md'))).toEqual([]);
    // No CLAUDE.md file, so Claude falls back to AGENTS.md.
    expect(paths(get(report, 'claude'), 'startup')).toEqual(['AGENTS.md']);
    for (const a of report.agents) expect(a.warnings, a.agent).toEqual([]);
  });
});

describe('CRLF line endings', () => {
  test('a CRLF copy of the repo loads the same files; only line endings differ', async () => {
    const lfRepo = tmpRepo(FILES);
    const crlfRepo = tmpRepo(crlf(FILES));
    for (const cwd of [[], ['packages', '日本']]) {
      const lf = await analyze({ cwd: path.join(lfRepo, ...cwd), agents: AGENT_IDS });
      const cr = await analyze({ cwd: path.join(crlfRepo, ...cwd), agents: AGENT_IDS });
      expectPosix(cr, crlfRepo);

      const lfItems = lf.agents.flatMap((a) => a.items);
      const crItems = cr.agents.flatMap((a) => a.items);
      expect(crItems.map(key)).toEqual(lfItems.map(key));

      for (const [n, c] of crItems.entries()) {
        const l = lfItems[n];
        if (!l) throw new Error('missing LF item');
        // Same reason (frontmatter parsed the same way), same text bar the \r.
        expect(c.reason, c.path).toBe(l.reason);
        expect(c.text.replaceAll('\r\n', '\n'), `${c.agent}:${c.path}`).toBe(l.text);
        const newlines = (l.text.match(/\n/g) ?? []).length;
        const fromFile = c.category !== 'skills';
        expect(c.bytes - l.bytes, `${c.agent}:${c.path}`).toBe(fromFile ? newlines : 0);
        if (c.skill) expect(c.skill).toEqual(l.skill);
        expect(c.importedFrom).toBe(l.importedFrom);
      }
      for (const [n, a] of cr.agents.entries()) {
        expect(a.warnings, a.agent).toEqual(lf.agents[n]?.warnings);
        expect(a.drops.map((d) => d.kind)).toEqual(lf.agents[n]?.drops.map((d) => d.kind));
        expect(a.startup.total).toBeGreaterThan(0);
      }
    }
  });

  test('CRLF frontmatter still sets paths:/globs:/applyTo:', async () => {
    const report = await analyze({ cwd: tmpRepo(crlf(FILES)), agents: AGENT_IDS });
    const reason = (agent: string, p: string) =>
      get(report, agent)?.items.find((i) => i.path === p)?.reason;
    expect(reason('claude', '.claude/rules/日本 paths.md')).toBe('paths: src/**/*.ts');
    expect(reason('cursor', '.cursor/rules/glob é.mdc')).toBe('globs: **/*.ts');
    expect(reason('copilot', '.github/instructions/café.instructions.md')).toContain('applyTo: **');
    // The frontmatter is not counted as part of a Cursor rule body.
    const body = get(report, 'cursor')?.items.find((i) => i.path === '.cursor/rules/日本 rule.mdc');
    expect(body?.text).toBe('Always 日本.\r\n');
  });
});
