// The workflows in docs/CI.md must be valid YAML and only use flags ctxsize really has.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { EXIT, run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

const doc = readFileSync(path.join(import.meta.dirname, '..', 'docs', 'CI.md'), 'utf8');
const yamlBlocks = [...doc.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');

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

describe('docs/CI.md', () => {
  test('has workflow examples', () => {
    expect(yamlBlocks.length).toBeGreaterThanOrEqual(3);
  });

  test('every full workflow parses and has a job with steps', () => {
    const workflows = yamlBlocks
      .map((y) => parse(y))
      .filter((w) => w && typeof w === 'object' && 'jobs' in w);
    expect(workflows.length).toBeGreaterThanOrEqual(2);
    for (const w of workflows) {
      expect(w.on).toBe('pull_request');
      const steps = Object.values<{ steps: unknown[] }>(w.jobs)[0]?.steps ?? [];
      expect(steps.length).toBeGreaterThan(2);
    }
  });

  test('every snippet parses as YAML', () => {
    for (const y of yamlBlocks) expect(() => parse(y)).not.toThrow();
  });

  test('every ctxsize flag in the examples exists', async () => {
    const help = (await cli(['--help'], tmpRepo({ '.git/': '' }))).stdout;
    const flags = new Set<string>();
    for (const m of doc.matchAll(/ctxsize(?:@[\w.]+)?((?: +[^\n|`]*)?)/g)) {
      for (const f of (m[1] ?? '').matchAll(/(?<=\s)--[a-z-]+/g)) flags.add(f[0]);
    }
    expect(flags.size).toBeGreaterThan(4);
    for (const flag of flags) expect(help, flag).toContain(flag);
  });

  test('the markdown comment is written even when the gate fails', async () => {
    const root = tmpRepo({ '.git/': '', 'AGENTS.md': 'Run the tests. '.repeat(100) });
    const file = path.join(root, 'comment.md');
    const r = await cli(['--quiet', '--max-tokens', '5', '--markdown', file], root);
    expect(r.code).toBe(EXIT.overBudget);
    expect(r.stderr).toContain('over --max-tokens 5');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('### ctxsize: what each agent loads');
  });
});
