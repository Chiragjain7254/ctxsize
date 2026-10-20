// The examples in docs/INTEGRATIONS.md must be valid and only use flags ctxsize really has.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { INIT_HELP } from '../src/init.ts';
import { run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

const doc = readFileSync(path.join(import.meta.dirname, '..', 'docs', 'INTEGRATIONS.md'), 'utf8');
const blocks = (lang: string) =>
  doc
    .split('```')
    .filter((_, i) => i % 2 === 1)
    .filter((part) => part.startsWith(`${lang}\n`))
    .map((part) => part.slice(lang.length + 1));

describe('docs/INTEGRATIONS.md', () => {
  test('the JSON examples parse', () => {
    const json = blocks('json');
    expect(json.length).toBeGreaterThanOrEqual(2);
    for (const j of json) expect(() => JSON.parse(j)).not.toThrow();
  });

  test('the workflow is valid and uses the action at the current version', () => {
    const workflow = parse(blocks('yaml')[0] ?? '');
    expect(workflow.on).toBe('pull_request');
    const steps = workflow.jobs.ctxsize.steps as { uses?: string }[];
    expect(steps.some((s) => s.uses?.startsWith('Chiragjain7254/ctxsize@v0.2.0'))).toBe(true);
  });

  test('the hook script has valid shell syntax shape and runs ctxsize', () => {
    const hook = blocks('sh').find((s) => s.startsWith('#!/bin/sh')) ?? '';
    expect(hook).toContain('git diff --cached --name-only');
    expect(hook.trimEnd().endsWith('fi')).toBe(true);
    expect(hook).toContain('ctxsize --quiet --max-tokens');
  });

  test('every ctxsize flag in the examples exists', async () => {
    let help = '';
    await run(['--help'], {
      stdout: (t) => {
        help += t;
      },
      stderr: () => {},
      env: {},
      isTTY: false,
      cwd: tmpRepo({ '.git/': '' }),
    });
    help += INIT_HELP;
    const flags = new Set<string>();
    for (const line of doc.split('\n').filter((l) => /ctxsize( |"|$)/.test(l))) {
      const after = line.slice(line.lastIndexOf('ctxsize'));
      for (const f of after.matchAll(/(?<=\s)--[a-z-]+/g)) flags.add(f[0]);
    }
    expect(flags.size).toBeGreaterThan(3);
    for (const flag of flags) expect(help, flag).toContain(flag);
  });
});
