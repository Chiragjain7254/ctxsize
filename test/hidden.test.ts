import { describe, expect, test } from 'vitest';
import { EXIT, run } from '../src/run.ts';
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

const claudeOnly = () => tmpRepo({ '.git/': '', 'CLAUDE.md': '# Rules\nBe brief.\n' });
const empty = () => tmpRepo({ '.git/': '' });

describe('hiding agents with no files', () => {
  test('by default, agents that load nothing are left out and listed after the table', async () => {
    const r = await cli([], claudeOnly());
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain('Claude Code');
    expect(r.stdout).toMatch(/Hidden: .*Aider.* \(no files found\) — use --all to show/);
    const table = r.stdout.split('Hidden:')[0] ?? '';
    expect(table).not.toContain('Aider');
  });

  test('--json has the visible agents and a hidden array of ids', async () => {
    const out = JSON.parse((await cli(['--json'], claudeOnly())).stdout);
    const shown = out.agents.map((a: { agent: string }) => a.agent);
    expect(shown).toContain('claude');
    expect(out.hidden).toContain('aider');
    expect(shown).not.toContain('aider');
  });

  test('--all shows every agent and hides none', async () => {
    const r = await cli(['--all'], claudeOnly());
    expect(r.stdout).toContain('Aider');
    expect(r.stdout).not.toContain('Hidden:');
    const out = JSON.parse((await cli(['--all', '--json'], claudeOnly())).stdout);
    expect(out.hidden).toEqual([]);
    expect(out.agents.length).toBeGreaterThan(5);
  });

  test('--agents always shows the listed agents, even when they load nothing', async () => {
    const r = await cli(['--agents', 'aider,claude'], claudeOnly());
    expect(r.stdout).toContain('Aider');
    expect(r.stdout).not.toContain('Hidden:');
    const out = JSON.parse((await cli(['--agents', 'aider', '--json'], claudeOnly())).stdout);
    expect(out.agents.map((a: { agent: string }) => a.agent)).toEqual(['aider']);
    expect(out.hidden).toEqual([]);
  });

  test('an empty repo hides everything and says so', async () => {
    const r = await cli([], empty());
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain('No agent loads any files from this repo.');
    expect(r.stdout).toContain('use --all to show');
    const out = JSON.parse((await cli(['--json'], empty())).stdout);
    expect(out.agents).toEqual([]);
    expect(out.hidden.length).toBeGreaterThan(5);
  });

  test('markdown lists the hidden agents', async () => {
    const r = await cli(['--markdown', '-'], claudeOnly());
    expect(r.stdout).toMatch(/_Hidden: .*\(no files found\) — use --all to show_/);
  });

  test('the HTML report notes the hidden agents, and explains how to add a file for an empty repo', async () => {
    const dir = empty();
    const r = await cli(['--html'], dir);
    expect(r.code).toBe(EXIT.ok);
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(`${dir}/ctxsize-report.html`, 'utf8');
    // With nothing to show, the Overview explains how to add an agent file.
    expect(html).toContain('id="empty"');
    expect(html).toContain('No agent files found');
    expect(html).toContain('npx @chiragjain7254/ctxsize --serve');
  });
});
