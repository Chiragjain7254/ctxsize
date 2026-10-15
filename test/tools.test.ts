import { symlinkSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { loadConfig, parseConfig } from '../src/config.ts';
import { analyze } from '../src/core/analyze.ts';
import { specProfiles } from '../src/profiles.ts';
import { buildTools } from '../src/tools.ts';
import { tmpRepo } from './helpers.ts';

const run = async (files: Record<string, string>, agents: string[], cwdSub = '') => {
  const repo = tmpRepo({ '.git/': '', ...files });
  const cwd = cwdSub ? `${repo}/${cwdSub}` : repo;
  const report = await analyze({ cwd, agents });
  const pick = (id: string) => report.agents.find((a) => a.agent === id);
  return { report, pick };
};
const paths = (a: { items: { path: string; load: string }[] } | undefined, load?: string) =>
  (a?.items ?? []).filter((i) => !load || i.load === load).map((i) => i.path);

describe('built-in profiles for the newer tools', () => {
  test('each cites https sources with a checked date', () => {
    for (const [id, spec] of Object.entries(specProfiles)) {
      expect(spec.sources?.length, id).toBeGreaterThan(0);
      for (const s of spec.sources ?? []) {
        expect(s.url).toMatch(/^https:\/\//);
        expect(s.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  test('there are ten built-in tools, hand-written ones first', () => {
    expect(buildTools().map((t) => t.id)).toEqual([
      'claude',
      'codex',
      'cursor',
      'copilot',
      'gemini',
      'opencode',
      'cline',
      'windsurf',
      'aider',
      'zed',
    ]);
  });

  test('OpenCode: AGENTS.md beats CLAUDE.md, nearest directory only', async () => {
    const { pick } = await run(
      { 'AGENTS.md': 'root\n', 'CLAUDE.md': 'claude\n', 'pkg/CLAUDE.md': 'pkg\n' },
      ['opencode'],
      'pkg',
    );
    expect(paths(pick('opencode'))).toEqual(['pkg/CLAUDE.md']);
    const both = await run({ 'AGENTS.md': 'a\n', 'CLAUDE.md': 'c\n' }, ['opencode']);
    expect(paths(both.pick('opencode'))).toEqual(['AGENTS.md']);
  });

  test('Cline: rules with paths: are on-demand, others startup', async () => {
    const { pick } = await run(
      {
        '.clinerules/always.md': 'always\n',
        '.clinerules/cond.md': '---\npaths:\n  - "src/**"\n---\nonly src\n',
        '.cursorrules': 'old\n',
      },
      ['cline'],
    );
    const cline = pick('cline');
    expect(paths(cline, 'startup').sort()).toEqual(['.clinerules/always.md', '.cursorrules']);
    expect(paths(cline, 'on-demand')).toEqual(['.clinerules/cond.md']);
  });

  test('Windsurf: trigger picks the mode and a rule over 12,000 chars is at-risk', async () => {
    const { pick } = await run(
      {
        '.windsurf/rules/a.md': `---\ntrigger: always_on\n---\n${'x'.repeat(12_100)}`,
        '.windsurf/rules/b.md': '---\ntrigger: manual\n---\nmanual\n',
        'AGENTS.md': 'agents\n',
      },
      ['windsurf'],
    );
    const w = pick('windsurf');
    expect(paths(w, 'startup').sort()).toEqual(['.windsurf/rules/a.md', 'AGENTS.md']);
    expect(paths(w, 'on-demand')).toEqual(['.windsurf/rules/b.md']);
    expect(w?.drops.map((d) => [d.kind, d.certainty, d.path])).toEqual([
      ['over-recommended-size', 'at-risk', '.windsurf/rules/a.md'],
    ]);
  });

  test('Aider: CONVENTIONS.md is on-demand because it must be passed in', async () => {
    const { pick } = await run({ 'CONVENTIONS.md': 'style\n' }, ['aider']);
    const a = pick('aider');
    expect(a?.startup.total).toBe(0);
    expect(paths(a, 'on-demand')).toEqual(['CONVENTIONS.md']);
  });

  test('Zed: first match in the documented order; the skill catalog is capped at 50 KB', async () => {
    const files: Record<string, string> = {
      '.rules': 'rules\n',
      'AGENTS.md': 'agents\n',
      '.github/copilot-instructions.md': 'cp\n',
    };
    for (let i = 0; i < 4; i++) {
      files[`.agents/skills/s${i}/SKILL.md`] =
        `---\nname: s${i}\ndescription: ${'d'.repeat(15_000)}\n---\nbody\n`;
    }
    const { pick } = await run(files, ['zed']);
    const z = pick('zed');
    expect(paths(z).filter((p) => !p.includes('skills'))).toEqual(['.rules']);
    const dropped = z?.drops.filter((d) => d.kind === 'skill-omitted') ?? [];
    expect(dropped.map((d) => d.skill)).toEqual(['s3']);
    expect(dropped[0]?.limit).toBe('zed.skillListingMaxBytes');
  });
});

describe('tools from ctxsize.json', () => {
  test('a new tool loads its globs, rules and skills', async () => {
    const { pick } = await run(
      {
        'ctxsize.json': JSON.stringify({
          tools: {
            mytool: {
              label: 'My Tool',
              instructions: ['docs/*.agent.md', 'MYTOOL.md'],
              rules: [{ dir: '.my/rules', glob: '*.md' }],
              skills: { dirs: ['.my/skills'] },
              limits: { maxFileBytes: 10 },
            },
          },
        }),
        'MYTOOL.md': 'x'.repeat(30),
        'docs/a.agent.md': 'doc\n',
        '.my/rules/r.md': 'rule\n',
        '.my/skills/s/SKILL.md': '---\nname: s\ndescription: does things\n---\nb\n',
      },
      ['mytool'],
    );
    const t = pick('mytool');
    expect(t?.label).toBe('My Tool');
    expect(paths(t, 'startup').sort()).toEqual([
      '.my/rules/r.md',
      '.my/skills/s/SKILL.md',
      'MYTOOL.md',
      'docs/a.agent.md',
    ]);
    expect(t?.drops.map((d) => [d.kind, d.path, d.bytesLost])).toEqual([
      ['file-truncated', 'MYTOOL.md', 20],
    ]);
  });

  test('a package.json "ctxsize" key works and ctxsize.json wins when both exist', () => {
    const tool = { a: { label: 'A', instructions: ['A.md'] } };
    const viaPkg = tmpRepo({ 'package.json': JSON.stringify({ ctxsize: { tools: tool } }) });
    expect(Object.keys(loadConfig(viaPkg)?.tools ?? {})).toEqual(['a']);
    const both = tmpRepo({
      'package.json': JSON.stringify({ ctxsize: { tools: tool } }),
      'ctxsize.json': JSON.stringify({ tools: { b: { label: 'B', instructions: ['B.md'] } } }),
    });
    expect(Object.keys(loadConfig(both)?.tools ?? {})).toEqual(['b']);
  });

  test('a user tool overrides fields of a built-in spec tool and keeps the rest', () => {
    const config = parseConfig({ tools: { zed: { instructions: ['ZED.md'] } } }, 'test');
    const zed = buildTools(config).find((t) => t.id === 'zed');
    expect(zed?.spec?.instructions).toEqual(['ZED.md']);
    expect(zed?.spec?.limits?.skillListingMaxBytes).toBe(50 * 1024);
    expect(zed?.origin).toBe('built-in');
  });

  test.each([
    [{ tools: { Bad_Id: { label: 'x', instructions: ['a'] } } }, /tool id/],
    [{ tools: { x: { label: 'x', instructoins: ['a'] } } }, /unknown key "instructoins"/],
    [{ tools: { x: { label: 'x', instructions: ['../a.md'] } } }, /not contain/],
    [{ tools: { x: { label: 'x', instructions: ['/etc/passwd'] } } }, /relative/],
    [{ tools: { x: { label: 'x', instructions: ['a\\b'] } } }, /separator/],
    [{ tools: { x: { label: 'x', limits: { maxFileBytes: -1 } } } }, /positive whole number/],
    [{ tools: { x: { label: 'x', search: 'everywhere' } } }, /one of/],
    [{ extra: 1 }, /unknown key "extra"/],
  ])('rejects %j', (raw, message) => {
    expect(() => parseConfig(raw, 'cfg')).toThrow(message);
  });

  test('buildTools rejects redefining a hand-written tool and a tool that loads nothing', () => {
    expect(() =>
      buildTools(parseConfig({ tools: { claude: { label: 'C', instructions: ['x'] } } }, 'cfg')),
    ).toThrow(/only "model" and "maxTokens" can be set/);
    expect(() => buildTools(parseConfig({ tools: { x: { label: 'X' } } }, 'cfg'))).toThrow(
      /at least one of/,
    );
    expect(() => buildTools(parseConfig({ tools: { x: { instructions: ['x'] } } }, 'cfg'))).toThrow(
      /"label" is required/,
    );
  });
});

describe('linked folders', () => {
  test('a skills folder linked into two places counts once', async () => {
    const repo = tmpRepo({
      '.git/': '',
      '.agents/skills/a/SKILL.md': '---\nname: a\ndescription: does a\n---\nbody\n',
      '.claude/': '',
    });
    try {
      symlinkSync(`${repo}/.agents/skills`, `${repo}/.claude/skills`, 'junction');
    } catch {
      return; // creating links is not allowed on this machine
    }
    const report = await analyze({ cwd: repo, agents: ['opencode'] });
    const skills = report.agents[0]?.items.filter((i) => i.category === 'skills') ?? [];
    expect(skills).toHaveLength(1);
  });
});
