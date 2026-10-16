import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { allModels } from '../src/models.ts';
import {
  badgeMarkdown,
  badgeText,
  compactTokens,
  renderBadgeSvg,
  renderCardSvg,
  renderMarkdown,
} from '../src/report/share.ts';
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

const repoFiles = {
  '.git/': '',
  'AGENTS.md': `# Rules\n\n${'Use small commits. '.repeat(300)}\n`,
  'CLAUDE.md': '# Claude\n\nSecret-ish body text that must never be printed.\n',
};

async function sample() {
  return analyze({
    cwd: tmpRepo(repoFiles),
    agents: ['claude', 'codex'],
    messages: 20,
    models: { models: allModels(), choice: { perTool: {} } },
  });
}

describe('compactTokens', () => {
  test.each([
    [0, '0'],
    [950, '950'],
    [1000, '1.0k'],
    [8819, '8.8k'],
    [12_400, '12k'],
  ])('%s -> %s', (n, text) => {
    expect(compactTokens(n)).toBe(text);
  });
});

describe('markdown summary', () => {
  test('has a table row per tool, the message count and no file contents', async () => {
    const md = renderMarkdown(await sample());
    expect(md).toContain('| Claude Code |');
    expect(md).toContain('| Codex |');
    expect(md).toContain('`AGENTS.md`');
    // No price was given: no cost column, only a hint.
    expect(md).not.toContain('Overhead cost');
    expect(md).toContain('Add --price 3 --per 1m to see cost.');
    expect(md).not.toContain('Secret-ish');
  });

  test('with a price the table gets a cost column in your currency', async () => {
    const report = await analyze({
      cwd: tmpRepo({ '.git/': '', 'AGENTS.md': 'Use npm. '.repeat(300) }),
      agents: ['codex'],
      messages: 20,
      price: { amount: 250, per: 1_000_000, currency: '₹' },
    });
    const md = renderMarkdown(report);
    expect(md).toContain('| Overhead cost |');
    expect(md).toMatch(/₹\d/);
    expect(md).not.toContain('$');
    expect(md).toContain('x 20 messages at ₹250 per 1M tokens');
  });

  test('a pipe in a label cannot break the table', async () => {
    const report = await sample();
    const first = report.agents[0];
    if (first) first.label = 'A|B';
    expect(renderMarkdown(report)).toContain('| A\\|B |');
  });
});

describe('SVG card and badge', () => {
  test('the card is well-formed enough to embed and escapes the title', async () => {
    const svg = renderCardSvg(await sample(), { title: '<script>alert(1)</script> & co' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&#60;script&#62;');
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test('the badge shows the heaviest tool and the shields.io snippet encodes it', async () => {
    const report = await sample();
    const worst = Math.max(...report.agents.map((a) => a.startup.total));
    expect(badgeText(report).value).toBe(`${compactTokens(worst)} tokens`);
    expect(renderBadgeSvg(report)).toContain(`ctxsize: ${compactTokens(worst)} tokens`);
    expect(badgeMarkdown(report)).toMatch(
      /^!\[ctxsize\]\(https:\/\/img\.shields\.io\/badge\/ctxsize-[\w.%-]+-2f6fed\)$/,
    );
  });
});

describe('share flags', () => {
  test('--markdown - prints the summary instead of the table', async () => {
    const r = await cli(['--markdown', '-', '--agents', 'claude'], tmpRepo(repoFiles));
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain('### ctxsize');
    expect(r.stdout).not.toContain('Cost of carrying it');
  });

  test('--markdown, --card and --badge write files relative to cwd', async () => {
    const dir = tmpRepo(repoFiles);
    const r = await cli(
      ['--markdown', 'out.md', '--card', 'card.svg', '--badge', 'badge.svg', '--title', 'My repo'],
      dir,
    );
    expect(r.code).toBe(EXIT.ok);
    for (const f of ['out.md', 'card.svg', 'badge.svg']) {
      expect(existsSync(path.join(dir, f)), f).toBe(true);
    }
    expect(readFileSync(path.join(dir, 'card.svg'), 'utf8')).toContain('My repo');
    expect(r.stderr).toContain('img.shields.io/badge/ctxsize-');
  });

  test('--json still wins on stdout and the files are still written', async () => {
    const dir = tmpRepo(repoFiles);
    const r = await cli(['--json', '--badge', 'b.svg'], dir);
    expect(JSON.parse(r.stdout).schemaVersion).toBe(2);
    expect(existsSync(path.join(dir, 'b.svg'))).toBe(true);
  });
});
