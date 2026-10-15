// .github/workflows/release.yml publishes on v* tags only, with provenance, and guards the version.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const root = path.join(import.meta.dirname, '..');
const workflow = parse(
  readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8'),
);
const steps: { name?: string; run?: string; uses?: string; env?: Record<string, string> }[] =
  workflow.jobs.publish.steps;
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const hasBash = spawnSync('bash', ['--version']).status === 0;

describe('release workflow', () => {
  test('runs only when a v* tag is pushed', () => {
    expect(workflow.on).toEqual({ push: { tags: ['v*'] } });
  });

  test('can sign provenance but cannot write to the repository', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
  });

  test('publishes to npm with provenance, using the NPM_TOKEN secret', () => {
    const publish = steps.find((s) => s.run?.includes('npm publish'));
    expect(publish?.run).toBe('npm publish --provenance --access public');
    expect(publish?.env?.NODE_AUTH_TOKEN).toMatch(/secrets.NPM_TOKEN/);
    const node = steps.find((s) => s.uses?.startsWith('actions/setup-node@')) as {
      with?: { 'registry-url'?: string };
    };
    expect(node.with?.['registry-url']).toBe('https://registry.npmjs.org');
  });

  test('skips the publish with a notice when NPM_TOKEN is missing or the version is on npm', () => {
    const gate = steps.find((s) => s.run?.includes('NPM_TOKEN is not set'));
    expect(gate?.run).toContain('is already on npm');
    expect(gate?.run).not.toContain('exit 1');
    const publish = steps.find((s) => s.run?.includes('npm publish')) as { if?: string };
    expect(publish.if).toBe("steps.gate.outputs.publish == 'true'");
  });

  test('checks everything before it publishes', () => {
    const order = steps.map((s) => s.run ?? s.uses ?? '');
    const at = (needle: string) => order.findIndex((r) => r.includes(needle));
    expect(at('npm ci')).toBeLessThan(at('npm run check'));
    expect(at('GITHUB_REF_NAME')).toBeLessThan(at('npm publish'));
    expect(at('npm run check')).toBeLessThan(at('npm publish'));
  });

  describe.skipIf(!hasBash)('the version guard', () => {
    const guard = steps.find((s) => s.run?.includes('GITHUB_REF_NAME'))?.run ?? '';
    const run = (tag: string) =>
      spawnSync('bash', ['-c', guard], {
        cwd: root,
        env: { ...process.env, GITHUB_REF_NAME: tag },
        encoding: 'utf8',
      });

    test('passes when the tag matches package.json and src/version.ts', () => {
      const r = run(`v${version}`);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toContain(
        `tag=${version} package.json=${version} src/version.ts=${version}`,
      );
    });

    test('fails when the tag names another version', () => {
      expect(run('v9.9.9').status).not.toBe(0);
    });
  });

  test('package.json and src/version.ts agree', () => {
    const src = readFileSync(path.join(root, 'src', 'version.ts'), 'utf8');
    expect(src).toContain(`VERSION = '${version}'`);
  });
});
