import { describe, expect, test } from 'vitest';
import { EXIT, run } from '../src/run.ts';
import { candidateDirs } from '../src/tree.ts';
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

const monorepo = () =>
  tmpRepo({
    '.git/': '',
    'AGENTS.md': 'Root rules.\n',
    'packages/web/AGENTS.md': `Web rules. ${'w '.repeat(400)}\n`,
    'packages/api/CLAUDE.md': `API rules. ${'a '.repeat(300)}\n`,
    'packages/api/.cursor/rules/x.mdc': '---\nalwaysApply: true\n---\nCursor rule for api.\n',
    'docs/readme.md': 'not an instruction file\n',
  });

describe('--tree', () => {
  test('lists the root and each folder with nested instructions, with deltas against the root', async () => {
    const r = await cli(['--json', '--tree', '--agents', 'codex,claude'], monorepo());
    expect(r.code).toBe(EXIT.ok);
    const { tree } = JSON.parse(r.stdout);
    expect(tree.map((row: { dir: string }) => row.dir)).toEqual([
      '.',
      'packages/api',
      'packages/web',
    ]);
    const [root, api, web] = tree;
    // Codex reads AGENTS.md from the root down to wherever it starts.
    expect(web.tools.codex).toBeGreaterThan(root.tools.codex);
    expect(api.tools.codex).toBe(root.tools.codex);
    // Claude reads the CLAUDE.md in the folder it starts in.
    expect(api.tools.claude).toBeGreaterThan(root.tools.claude);
  });

  test('the terminal view shows only tools that change, with +deltas', async () => {
    const r = await cli(['--tree', '--agents', 'codex,claude'], monorepo());
    expect(r.stdout).toContain('By starting folder');
    expect(r.stdout).toMatch(/packages\/web\s+.*\(\+\d+\)/);
    expect(r.stdout).not.toContain(process.cwd());
  });

  test('a repo with no nested files says so', async () => {
    const dir = tmpRepo({ '.git/': '', 'AGENTS.md': 'x\n' });
    const r = await cli(['--tree'], dir);
    expect(r.stdout).toContain('No nested instruction files found.');
  });

  test('works without a .git folder: the given directory is the root', async () => {
    const dir = tmpRepo({ 'AGENTS.md': 'x\n', 'sub/AGENTS.md': `${'y '.repeat(300)}\n` });
    const r = await cli(['--json', '--tree', '--agents', 'codex'], dir);
    const { tree } = JSON.parse(r.stdout);
    expect(tree.map((row: { dir: string }) => row.dir)).toEqual(['.', 'sub']);
    expect(tree[1].tools.codex).toBeGreaterThan(tree[0].tools.codex);
  });

  test('without --tree the report has no tree', async () => {
    const r = await cli(['--json'], monorepo());
    expect(JSON.parse(r.stdout).tree).toBeUndefined();
  });
});

describe('candidateDirs', () => {
  test('caps the number of folders and says how many were skipped', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      scope: 'project' as const,
      path: `pkg${String(i).padStart(2, '0')}/AGENTS.md`,
    }));
    const report = { agents: [{ items }] } as never;
    const { dirs, skipped } = candidateDirs(report);
    expect(dirs).toHaveLength(30);
    expect(dirs[0]).toBe('.');
    expect(skipped).toBe(21);
  });

  test('user files and dot-folder contents map to the folder that contains the dot-folder', () => {
    const report = {
      agents: [
        {
          items: [
            { scope: 'user', path: '~/.claude/CLAUDE.md' },
            { scope: 'project', path: 'a/b/.cursor/rules/r.mdc' },
          ],
        },
      ],
    } as never;
    expect(candidateDirs(report).dirs).toEqual(['.', 'a/b']);
  });
});
