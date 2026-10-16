import { describe, expect, test } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { analyze } from '../src/core/analyze.ts';
import { EXIT, run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

const files = {
  '.git/': '',
  'AGENTS.md': '# Agents\n\nRun the tests.\n',
  'CLAUDE.local.md': '# Local notes\n',
  'packages/app/AGENTS.md': '# App\n',
  'docs/old/AGENTS.md': '# Old docs\n',
  '.claude/skills/x/SKILL.md': '---\nname: x\ndescription: Does x. Use when x.\n---\nBody\n',
};

const paths = async (root: string, exclude: string[], agent = 'claude') => {
  const report = await analyze({ cwd: root, agents: [agent], exclude, checks: false });
  return report.agents[0]?.items
    .filter((i) => i.load !== 'ignored')
    .map((i) => i.path)
    .sort();
};

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

describe('exclude globs', () => {
  test('nothing is excluded by default', async () => {
    const kept = await paths(tmpRepo(files), []);
    expect(kept).toContain('CLAUDE.local.md');
    expect(kept).not.toContain('AGENTS.md'); // ignored for Claude Code while a CLAUDE file exists
  });

  test('a name without a slash matches at any depth', async () => {
    const root = tmpRepo({ ...files, 'packages/app/CLAUDE.local.md': '# More\n' });
    const kept = await paths(root, ['CLAUDE.local.md']);
    expect(kept).not.toContain('CLAUDE.local.md');
    expect(kept).not.toContain('packages/app/CLAUDE.local.md');
    expect(kept).toContain('AGENTS.md'); // the only CLAUDE file is gone, so AGENTS.md loads
  });

  test('a folder glob removes everything inside it', async () => {
    const root = tmpRepo(files);
    const kept = await paths(root, ['packages/**', 'docs']);
    expect(kept).not.toContain('packages/app/AGENTS.md');
    expect(kept).not.toContain('docs/old/AGENTS.md');
  });

  test('an excluded CLAUDE.md lets AGENTS.md load, as if it did not exist', async () => {
    const root = tmpRepo({ '.git/': '', 'CLAUDE.md': '# C\n', 'AGENTS.md': '# A\n' });
    expect(await paths(root, [])).toEqual(['CLAUDE.md']);
    const report = await analyze({ cwd: root, agents: ['claude'], exclude: ['CLAUDE.md'] });
    expect(report.agents[0]?.items.map((i) => [i.path, i.load])).toEqual([
      ['AGENTS.md', 'startup'],
    ]);
  });

  test('skills can be excluded by folder', async () => {
    const root = tmpRepo(files);
    expect(await paths(root, ['.claude/skills/**'])).not.toContain('.claude/skills/x/SKILL.md');
  });

  test('the exclusion does not leak into the next analysis', async () => {
    const root = tmpRepo(files);
    await paths(root, ['AGENTS.md']);
    expect(await paths(root, [], 'codex')).toContain('AGENTS.md');
  });
});

describe('--exclude and the "exclude" config key', () => {
  test('--exclude is repeatable', async () => {
    const root = tmpRepo(files);
    const r = await cli(
      ['--json', '--agents', 'cursor', '--exclude', 'AGENTS.md', '--exclude', 'docs'],
      root,
    );
    expect(r.code).toBe(EXIT.ok);
    expect(JSON.parse(r.stdout).agents[0].items).toEqual([]);
  });

  test('the config key and the flag add up', async () => {
    const root = tmpRepo({ ...files, 'ctxsize.json': '{ "exclude": ["packages"] }' });
    const r = await cli(['--json', '--agents', 'cursor', '--exclude', 'docs'], root);
    const items: { path: string }[] = JSON.parse(r.stdout).agents[0].items;
    expect(items.map((i) => i.path)).toEqual(['AGENTS.md']);
  });

  test('the config key is validated', () => {
    expect(() => parseConfig({ exclude: '*.md' }, 'ctxsize.json')).toThrow(
      /expected a non-empty list/,
    );
    expect(() => parseConfig({ exclude: ['../x'] }, 'ctxsize.json')).toThrow(/not contain "\.\."/);
    expect(parseConfig({ exclude: ['docs'] }, 'ctxsize.json').exclude).toEqual(['docs']);
  });

  test('backslashes suggest the equivalent slash pattern', async () => {
    const root = tmpRepo(files);
    const r = await cli(['--exclude', 'docs\\old\\*.md'], root);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain('Did you mean "docs/old/*.md"?');
  });

  test('bad patterns are usage errors', async () => {
    const root = tmpRepo(files);
    for (const bad of ['../x', '/abs', 'C:x', 'C:\\x', 'a\\b']) {
      const r = await cli(['--exclude', bad], root);
      expect(r.code, bad).toBe(EXIT.usage);
      expect(r.stderr).toContain('--exclude must be a glob relative to the repo');
    }
    const drive = await cli(['--exclude', 'C:\\x'], root);
    expect(drive.stderr).not.toContain('Did you mean');
  });
});
