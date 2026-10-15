// Files written on Windows: CRLF line endings (and a BOM) in every kind of file ctxsize reads,
// and Windows-style paths. Reports must be the same as for the LF files, with "/" paths.
import { statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { analyze } from '../src/core/analyze.ts';
import { parseFrontmatter } from '../src/core/frontmatter.ts';
import { walkFiles } from '../src/core/fs.ts';
import { parseGitignore } from '../src/core/gitignore.ts';
import { findImports } from '../src/core/imports.ts';
import { tmpRepo } from './helpers.ts';

const BOM = '\ufeff';
const crlf = (s: string) => s.replaceAll('\n', '\r\n');

describe('CRLF in the files ctxsize parses', () => {
  test('imports: no carriage return in the target, and fences still close', () => {
    const text = crlf('See @docs/a.md for style.\n```\n@not/an/import.md\n```\nThen @docs/b.md\n');
    expect(findImports(text)).toEqual(['docs/a.md', 'docs/b.md']);
  });

  test('frontmatter: the block is read and the body keeps its own line endings', () => {
    const fm = parseFrontmatter(
      crlf('---\nname: x\ndescription: Does x. Use when x.\npaths: src/**\n---\nBody\n'),
    );
    expect(fm.error).toBeUndefined();
    expect(fm.data).toEqual({ name: 'x', description: 'Does x. Use when x.', paths: 'src/**' });
    expect(fm.body).toBe('Body\r\n');
  });

  test('frontmatter: a folded multi-line description keeps its words', () => {
    const fm = parseFrontmatter(
      crlf(
        '---\nname: x\ndescription: >\n  Formats the changelog.\n  Use when releasing.\n---\nBody\n',
      ),
    );
    expect(String(fm.data.description).replace(/\s+/g, ' ').trim()).toBe(
      'Formats the changelog. Use when releasing.',
    );
  });

  test('.gitignore: CRLF lines, comments and negation still work', () => {
    const ignore = parseGitignore(crlf('# comment\nbuild-output/\n*.log\n!keep.log\n'));
    expect(ignore.ignores('build-output', true)).toBe(true);
    expect(ignore.ignores('a/b.log', false)).toBe(true);
    expect(ignore.ignores('keep.log', false)).toBe(false);
    expect(ignore.ignores('src', true)).toBeUndefined();
  });

  test('.gitignore with CRLF keeps ignored folders out of the walk', () => {
    const root = tmpRepo({
      '.git/': '',
      '.gitignore': crlf('generated/\n'),
      'generated/AGENTS.md': '# not read\n',
      'src/AGENTS.md': '# read\n',
    });
    const rel = walkFiles(root).map((f) => path.relative(root, f).split(path.sep).join('/'));
    expect(rel).toContain('src/AGENTS.md');
    expect(rel).not.toContain('generated/AGENTS.md');
  });

  test('ctxsize.json with CRLF and a BOM is read', () => {
    const json = crlf('{\n  "messages": 80,\n  "exclude": ["docs/old"]\n}\n');
    const root = tmpRepo({ 'ctxsize.json': BOM + json });
    expect(loadConfig(root)).toMatchObject({ messages: 80, exclude: ['docs/old'] });
  });
});

describe('a repo written with CRLF', () => {
  const rule = 'Use pnpm and write tests first.\n'.repeat(10);
  const lf: Record<string, string> = {
    '.git/': '',
    'CLAUDE.md': `# Claude\n\nSee @docs/style.md\n\n${rule}`,
    'docs/style.md': '# Style\n\nTwo-space indent.\n',
    'AGENTS.md': `# Agents\n\n${rule}`,
    '.claude/rules/ts.md': '---\npaths: src/**/*.ts\n---\nStrict mode.\n',
    '.claude/skills/x/SKILL.md':
      '---\nname: x\ndescription: Formats the changelog. Use when releasing.\n---\nBody\n',
    '.cursor/rules/a.mdc': '---\nalwaysApply: true\n---\nBe kind.\n',
    '.github/instructions/ts.instructions.md': '---\napplyTo: "src/**/*.ts"\n---\nTS only.\n',
  };
  const asCrlf = () => Object.fromEntries(Object.entries(lf).map(([k, v]) => [k, crlf(v)]));
  const shape = (r: Awaited<ReturnType<typeof analyze>>) =>
    r.agents.map((a) => [a.agent, a.items.map((i) => [i.path, i.load, i.category])]);

  test('loads the same files, in the same way, as the LF repo', async () => {
    const a = await analyze({ cwd: tmpRepo(lf), checks: false });
    const b = await analyze({ cwd: tmpRepo(asCrlf()), checks: false });
    expect(shape(b)).toEqual(shape(a));
  });

  test('counts the bytes on disk, carriage returns included', async () => {
    const text = crlf('# Agents\n\nRun the tests.\nThen commit.\n');
    const root = tmpRepo({ '.git/': '', 'AGENTS.md': text });
    const report = await analyze({ cwd: root, agents: ['codex'], checks: false });
    const item = report.agents[0]?.items[0];
    expect(item?.bytes).toBe(statSync(path.join(root, 'AGENTS.md')).size);
    expect(item?.bytes).toBe(text.length);
  });

  test('a CRLF copy of an LF file is still reported as a duplicate', async () => {
    const root = tmpRepo({
      '.git/': '',
      'AGENTS.md': lf['AGENTS.md'] ?? '',
      'CLAUDE.md': crlf(lf['AGENTS.md'] ?? ''),
    });
    const report = await analyze({ cwd: root, agents: ['claude', 'copilot'] });
    expect(report.checks.some((c) => c.code === 'duplicate-file')).toBe(true);
  });

  test('a skill with CRLF frontmatter lists its description', async () => {
    const root = tmpRepo(asCrlf());
    const report = await analyze({ cwd: root, agents: ['claude'], checks: false });
    const skill = report.agents[0]?.items.find((i) => i.skill);
    expect(skill?.skill?.description).toBe('Formats the changelog. Use when releasing.');
  });
});

describe('Windows-style paths', () => {
  test('an import with a drive letter or backslashes loads nothing outside the repo and leaks no local path', async () => {
    const root = tmpRepo({
      '.git/': '',
      'CLAUDE.md':
        '# C\n\nSee @C:\\Users\\me\\secret.md and @..\\outside.md and @docs\\missing.md\n',
    });
    const report = await analyze({ cwd: root, agents: ['claude'], checks: false });
    const json = JSON.stringify(report, (k, v) => (k === 'text' ? undefined : v));
    expect(report.agents[0]?.items.map((i) => i.path)).toEqual(['CLAUDE.md']);
    expect(report.agents[0]?.warnings.length).toBeGreaterThan(0); // skipped, and said so
    expect(json).not.toContain(path.basename(root));
  });

  test('every path in a report uses "/" for a repo with spaces and a deep tree', async () => {
    const root = tmpRepo({
      '.git/': '',
      'My Docs/Sub Folder/CLAUDE.md': '# Nested\n',
      'AGENTS.md': '# Root\n',
    });
    const report = await analyze({ cwd: path.join(root, 'My Docs', 'Sub Folder'), root });
    for (const agent of report.agents) {
      for (const item of agent.items) expect(item.path).not.toContain('\\');
    }
    expect(report.agents[0]?.items.map((i) => i.path)).toContain('My Docs/Sub Folder/CLAUDE.md');
  });
});
