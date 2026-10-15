// action.yml: a composite action that runs ctxsize. The script is run here with a fake npx.
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { tmpRepo } from './helpers.ts';

const root = path.join(import.meta.dirname, '..');
const action = parse(readFileSync(path.join(root, 'action.yml'), 'utf8'));
const script: string = action.runs.steps.find((s: { run?: string }) => s.run)?.run ?? '';
const pkgVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const hasBash = spawnSync('bash', ['--version']).status === 0;

/** Runs the action's script with a fake npx that prints its arguments, one per line. */
function runScript(env: Record<string, string>, fakeExit = 0) {
  const dir = tmpRepo({});
  const npx = path.join(dir, 'npx');
  writeFileSync(npx, `#!/bin/bash\nfor a in "$@"; do echo "ARG:$a"; done\nexit ${fakeExit}\n`);
  chmodSync(npx, 0o755);
  const toPosix = (p: string) => p.split(path.sep).join('/');
  const r = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${toPosix(dir)}:${process.env.PATH}`,
      CTXSIZE_DIRECTORY: '.',
      CTXSIZE_VERSION: '',
      CTXSIZE_ACTION_PATH: toPosix(root),
      CTXSIZE_FAIL_ON_WARNINGS: 'false',
      CTXSIZE_AGENTS: '',
      CTXSIZE_MAX_TOKENS: '',
      CTXSIZE_MAX_PERCENT: '',
      ...env,
    },
  });
  const args = r.stdout
    .split('\n')
    .filter((l) => l.startsWith('ARG:'))
    .map((l) => l.slice(4).replace(/\r$/, ''));
  return { status: r.status, args, stdout: r.stdout, stderr: r.stderr };
}

describe('action.yml', () => {
  test('is a composite action with the documented inputs', () => {
    expect(action.runs.using).toBe('composite');
    expect(Object.keys(action.inputs).sort()).toEqual([
      'agents',
      'directory',
      'fail-on-warnings',
      'max-percent',
      'max-tokens',
      'node-version',
      'version',
    ]);
    for (const input of Object.values<{ description: string }>(action.inputs)) {
      expect(input.description.length).toBeGreaterThan(10);
    }
    expect(action.name).toBe('ctxsize');
  });

  test('sets up Node and passes inputs through env, never into the script text', () => {
    expect(action.runs.steps[0].uses).toMatch(/^actions\/setup-node@/);
    expect(script).not.toContain('${{');
    for (const step of action.runs.steps) {
      if (step.run) expect(step.shell).toBe('bash');
    }
  });

  test('every input is documented in docs/CI.md', () => {
    const doc = readFileSync(path.join(root, 'docs', 'CI.md'), 'utf8');
    for (const name of Object.keys(action.inputs)) expect(doc, name).toContain(`\`${name}\``);
  });

  test.skipIf(!hasBash)('with no inputs it runs a quiet check of the current folder', () => {
    const r = runScript({});
    expect(r.status).toBe(0);
    expect(r.args).toEqual(['--yes', `@chiragjain7254/ctxsize@${pkgVersion}`, '--quiet', '.']);
  });

  test.skipIf(!hasBash)('the version input overrides the default, including "latest"', () => {
    expect(runScript({ CTXSIZE_VERSION: 'latest' }).args[1]).toBe('@chiragjain7254/ctxsize@latest');
  });

  test('the version input defaults to empty, never to latest', () => {
    expect(action.inputs.version.default).toBe('');
  });

  test.skipIf(!hasBash)('passes agents, limits, warnings, directory and version', () => {
    const r = runScript({
      CTXSIZE_AGENTS: 'claude,codex',
      CTXSIZE_MAX_TOKENS: '8000',
      CTXSIZE_MAX_PERCENT: '2.5',
      CTXSIZE_FAIL_ON_WARNINGS: 'true',
      CTXSIZE_DIRECTORY: 'packages/app',
      CTXSIZE_VERSION: '0.1.0',
    });
    expect(r.args).toEqual([
      '--yes',
      '@chiragjain7254/ctxsize@0.1.0',
      '--quiet',
      '--agents',
      'claude,codex',
      '--max-tokens',
      '8000',
      '--max-percent',
      '2.5',
      '--fail-on-warnings',
      'packages/app',
    ]);
  });

  test.skipIf(!hasBash)('a value with spaces or shell characters stays one argument', () => {
    const r = runScript({ CTXSIZE_DIRECTORY: 'my repo; echo pwned', CTXSIZE_AGENTS: '$(echo x)' });
    expect(r.args.slice(-3)).toEqual(['--agents', '$(echo x)', 'my repo; echo pwned']);
    expect(r.stdout.split('\n')).not.toContain('pwned');
  });

  test.skipIf(!hasBash)('the exit code of ctxsize fails the step', () => {
    expect(runScript({}, 1).status).toBe(1);
    expect(runScript({}, 2).status).toBe(2);
  });
});
