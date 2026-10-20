import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, test, vi } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { CARD_H, CARD_W, renderCardPng, renderCardSvg } from '../src/report/card.ts';
import { Canvas } from '../src/report/pixel.ts';
import { badgeMarkdown } from '../src/report/share.ts';
import { run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

vi.setConfig({ testTimeout: 30_000 });

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

const messy = {
  '.git/': '',
  'AGENTS.md': `# Rules\n\n${'Always run the whole test suite before a commit. '.repeat(900)}\n`,
  '.claude/skills/deploy/SKILL.md': '---\nname: deploy\n---\nSteps\n',
};

const sample = async () => {
  const dir = tmpRepo(messy);
  return analyze({ cwd: dir, root: dir });
};

describe('the share card', () => {
  test('the SVG shows the grade, the first fixes and the agents, and nothing external', async () => {
    const svg = renderCardSvg(await sample(), { title: 'My repo' });
    expect(svg).toContain(`width="${CARD_W}" height="${CARD_H}"`);
    expect(svg).toContain('My repo');
    expect(svg).toContain('Context health');
    expect(svg).toContain('Fix these first');
    expect(svg).toContain('AGENTS.md is too big for Codex');
    expect(svg).toContain('Codex');
    expect(svg).toMatch(/>[A-F]<\/text>/);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg).not.toContain('<image');
  });

  test('a clean repo says so', async () => {
    const dir = tmpRepo({ '.git/': '', 'AGENTS.md': '# R\n\nUse npm.\n' });
    const svg = renderCardSvg(await analyze({ cwd: dir, root: dir }));
    expect(svg).toContain('Nothing to fix.');
    expect(svg).toContain('>A</text>');
  });

  test('the title is escaped and long ones are cut', async () => {
    const svg = renderCardSvg(await sample(), { title: `<b>&${'x'.repeat(80)}` });
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&#60;b&#62;&#38;');
    expect(svg).toContain('...');
  });

  test('at most three fixes, then "more in the Fix list"', async () => {
    const dir = tmpRepo({
      '.git/': '',
      ...Object.fromEntries(
        [1, 2, 3, 4, 5].map((n) => [`.claude/skills/s${n}/SKILL.md`, `---\nname: s${n}\n---\nx\n`]),
      ),
    });
    const svg = renderCardSvg(await analyze({ cwd: dir, root: dir }));
    expect(svg.match(/>[1-3]<\/text>/g)?.length).toBeGreaterThanOrEqual(3);
    expect(svg).not.toMatch(/>4<\/text>/);
    expect(svg).toContain('more in the Fix list');
  });

  test('the PNG is a valid RGB image of the right size', async () => {
    const png = renderCardPng(await sample());
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(CARD_W);
    expect(png.readUInt32BE(20)).toBe(CARD_H);
    const idat = png.indexOf('IDAT');
    const length = png.readUInt32BE(idat - 4);
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + length));
    expect(raw.length).toBe((CARD_W * 3 + 1) * CARD_H);
    expect(png.subarray(-12).toString('latin1', 4, 8)).toBe('IEND');
  });

  test('the pixel canvas draws text and rounded rectangles', () => {
    const c = new Canvas(40, 20, '#ffffff');
    c.rect(0, 0, 10, 10, 5, '#ff0000');
    expect(c.data.slice(0, 3)).toEqual(new Uint8Array([255, 255, 255])); // the cut corner
    expect(c.data.slice((5 * 40 + 5) * 3, (5 * 40 + 5) * 3 + 3)).toEqual(
      new Uint8Array([255, 0, 0]),
    );
    c.text('A', 20, 2, 2, '#000000');
    expect(c.data.some((v, i) => i % 3 === 0 && v === 0)).toBe(true);
  });
});

describe('--card and --badge', () => {
  test('--card with .png writes only a PNG, with .svg only an SVG, with no extension both', async () => {
    const dir = tmpRepo(messy);
    await cli(['--card', 'a.png'], dir);
    await cli(['--card', 'b.svg'], dir);
    const both = await cli(['--card', 'c'], dir);
    expect(both.code).toBe(0);
    for (const f of ['a.png', 'b.svg', 'c.svg', 'c.png']) {
      expect(existsSync(path.join(dir, f)), f).toBe(true);
    }
    expect(existsSync(path.join(dir, 'a.svg'))).toBe(false);
    expect(readFileSync(path.join(dir, 'c.png')).subarray(1, 4).toString()).toBe('PNG');
    expect(readFileSync(path.join(dir, 'c.svg'), 'utf8').startsWith('<svg')).toBe(true);
  });

  test('a bare --badge prints one Markdown line and nothing else', async () => {
    const dir = tmpRepo(messy);
    const r = await cli(['--badge'], dir);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(
      /^\[!\[ctxsize: [A-F] · .+\]\(https:\/\/img\.shields\.io\/badge\/.+\)\]\(.+\)\n$/,
    );
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
  });

  test('--badge before another flag is still bare, and a file still writes the SVG', async () => {
    const dir = tmpRepo(messy);
    const bare = await cli(['--badge', '--no-color'], dir);
    expect(bare.stdout.startsWith('[![ctxsize')).toBe(true);
    const file = await cli(['--badge', 'b.svg'], dir);
    expect(existsSync(path.join(dir, 'b.svg'))).toBe(true);
    expect(file.stderr).toContain('img.shields.io');
  });

  test('--json keeps stdout when --badge is bare; the snippet goes to stderr', async () => {
    const dir = tmpRepo(messy);
    const r = await cli(['--json', '--badge'], dir);
    expect(JSON.parse(r.stdout).schemaVersion).toBe(2);
    expect(r.stderr).toContain('[![ctxsize');
  });

  test('the badge snippet carries the grade', async () => {
    const report = await sample();
    expect(badgeMarkdown(report)).toContain('ctxsize: C');
  });
});
