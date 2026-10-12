import { describe, expect, test } from 'vitest';
import { computeChecks } from '../src/checks.ts';
import { analyze } from '../src/core/analyze.ts';
import { countTokens } from '../src/core/tokenize.ts';
import type { AgentReport, Category, LoadedItem } from '../src/core/types.ts';
import { EXIT, run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

function file(
  agent: string,
  path: string,
  text: string,
  extra: Partial<LoadedItem> = {},
  category: Category = 'instructions',
): LoadedItem {
  return {
    agent,
    path,
    scope: 'project',
    category,
    load: 'startup',
    reason: 'test',
    text,
    bytes: text.length,
    tokens: countTokens(text),
    order: 0,
    ...extra,
  };
}

function skill(
  agent: string,
  name: string,
  description: string,
  extra: { whenToUse?: string; path?: string } = {},
): LoadedItem {
  const bodyPath = extra.path ?? `.claude/skills/${name}/SKILL.md`;
  return file(
    agent,
    bodyPath,
    `- ${name}: ${description}\n`,
    {
      skill: {
        name,
        description,
        bodyPath,
        ...(extra.whenToUse ? { whenToUse: extra.whenToUse } : {}),
      },
    },
    'skills',
  );
}

function agent(id: string, items: LoadedItem[], over: Partial<AgentReport> = {}): AgentReport {
  const total = items.filter((i) => i.load === 'startup').reduce((s, i) => s + i.tokens, 0);
  return {
    agent: id,
    label: id,
    contextTokens: 200_000,
    items,
    startup: { total },
    topFiles: [...items]
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5)
      .map((i) => ({ path: i.path, tokens: i.tokens, category: i.category })),
    ...over,
  } as AgentReport;
}

const SENTENCE =
  'Always run the full test suite before opening a pull request and never skip failing tests.';
const checksOf = (agents: AgentReport[], limits: Record<string, number> = {}) =>
  computeChecks(agents, { descriptionLimits: limits });
const codes = (agents: AgentReport[], limits?: Record<string, number>) =>
  checksOf(agents, limits).map((c) => c.code);

describe('duplicate files', () => {
  test('identical CLAUDE.md and AGENTS.md give one check, not per-paragraph noise', () => {
    const text = `# Rules\n\n${SENTENCE}\n\nUse pnpm for installing dependencies, never npm or yarn.\n`;
    const checks = checksOf([
      agent('claude', [file('claude', 'CLAUDE.md', text)]),
      agent('codex', [file('codex', 'AGENTS.md', text)]),
    ]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.code).toBe('duplicate-file');
    expect(checks[0]?.message).toBe(
      `AGENTS.md and CLAUDE.md are identical, ${countTokens(text)} tokens duplicated`,
    );
    expect(checks[0]?.severity).toBe('info'); // no single tool loads both
  });

  test('whitespace, case and CRLF differences still count as identical', () => {
    const a = `# Rules\r\n\r\n${SENTENCE}\r\n`;
    const b = `# Rules\n\n  ${SENTENCE.toUpperCase()}   \n\n\n`;
    expect(
      codes([
        agent('claude', [file('claude', 'CLAUDE.md', a)]),
        agent('codex', [file('codex', 'AGENTS.md', b)]),
      ]),
    ).toEqual(['duplicate-file']);
  });

  test('the same AGENTS.md read by every tool is not a duplicate', () => {
    const text = `${SENTENCE}\n\n${SENTENCE.replace('full', 'whole')}\n`;
    const tools = ['claude', 'codex', 'cursor', 'copilot', 'gemini'];
    expect(codes(tools.map((t) => agent(t, [file(t, 'AGENTS.md', text)])))).toEqual([]);
  });

  test('two files loaded by one tool are a warning naming the tool', () => {
    const text = `${SENTENCE}\n\nKeep functions small and name them after what they return.\n`;
    const [c] = checksOf([
      agent('claude', [file('claude', 'CLAUDE.md', text), file('claude', 'docs/a.md', text)]),
    ]);
    expect(c).toMatchObject({ severity: 'warn', tool: 'claude', code: 'duplicate-file' });
  });

  test('a file that imports another is not a duplicate of it', () => {
    const text = `${SENTENCE}\n\nKeep functions small and name them after what they return.\n`;
    expect(
      codes([
        agent('claude', [
          file('claude', 'CLAUDE.md', text),
          file('claude', 'AGENTS.md', text, { importedFrom: 'CLAUDE.md' }),
        ]),
      ]),
    ).toEqual([]);
  });

  test('different or tiny files are not duplicates', () => {
    expect(
      codes([
        agent('claude', [
          file('claude', 'CLAUDE.md', 'Use tabs.\n'),
          file('claude', 'x.md', 'Use tabs.\n'),
        ]),
      ]),
    ).toEqual([]);
  });
});

describe('duplicate paragraphs', () => {
  const shared = `${SENTENCE} ${SENTENCE.replace('full', 'whole')} Document every public function with examples.`;

  const unique = (tag: string) =>
    `Only file ${tag} says that generated code must never be edited by hand, and that releases need a changelog entry first.`.repeat(
      3,
    );

  test('a long paragraph found in two different files is reported once with tokens', () => {
    const checks = checksOf([
      agent('claude', [
        file(
          'claude',
          'CLAUDE.md',
          `# A\n\nBuild with npm run build.\n\n${unique('a')}

${shared}\n`,
        ),
        file(
          'claude',
          '.claude/rules/b.md',
          `# B\n\nLint with biome please for everything.\n\n${unique('b')}

${shared}\n`,
          { category: 'rules' },
        ),
      ]),
    ]);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ code: 'duplicate-paragraphs', severity: 'warn' });
    expect(checks[0]?.tokens).toBe(countTokens(shared.toLowerCase().replace(/\s+/g, ' ')));
    expect(checks[0]?.paths).toEqual(['.claude/rules/b.md', 'CLAUDE.md']);
  });

  test('duplicated list items count, whatever the bullet', () => {
    const item = `${SENTENCE} ${SENTENCE.replace('full', 'whole')}`;
    expect(
      codes([
        agent('claude', [
          file('claude', 'CLAUDE.md', `# A\n\n- ${item}\n- Something else entirely about style.\n`),
          file('claude', 'b.md', `# B\n\n* ${item}\n\n1. Another unrelated line about commits.\n`),
        ]),
      ]),
    ).toEqual(['duplicate-paragraphs']);
  });

  test('short repeated lines and code blocks are ignored', () => {
    const code = '```sh\nnpm run build && npm run test && npm run lint && npm run typecheck\n```';
    expect(
      codes([
        agent('claude', [
          file('claude', 'CLAUDE.md', `# A\n\nRun tests.\n\n${code}\n`),
          file('claude', 'b.md', `# B\n\nRun tests.\n\n${code}\n\nMore.\n`),
        ]),
      ]),
    ).toEqual([]);
  });

  test('files that share nearly everything are one near-identical check', () => {
    const body = Array.from({ length: 8 }, (_, i) => `${SENTENCE} Rule number ${i} applies here.`);
    const checks = checksOf([
      agent('claude', [file('claude', 'CLAUDE.md', body.join('\n\n'))]),
      agent('codex', [
        file('codex', 'AGENTS.md', `${body.join('\n\n')}\n\nExtra line only here.\n`),
      ]),
    ]);
    expect(checks.map((c) => c.code)).toEqual(['near-identical-files']);
  });
});

describe('suggestions', () => {
  const bigSection = (heading: string) =>
    `## ${heading}\n\n${Array.from({ length: 120 }, (_, i) => `Step detail ${i}: run the staging script, wait, then verify the dashboard shows green.`).join('\n')}\n`;

  test('a big task-specific section is suggested for a skill', () => {
    const text = `# Project\n\nSmall intro.\n\n${bigSection('Deploying to production')}`;
    const [c] = checksOf([agent('claude', [file('claude', 'CLAUDE.md', text)])]);
    expect(c).toMatchObject({ kind: 'suggestion', code: 'move-to-skill', paths: ['CLAUDE.md'] });
    expect(c?.message).toMatch(/^move 'Deploying to production' \([\d,]+ tokens\) into a skill/);
    expect(c?.tokens).toBeGreaterThan(800);
  });

  test('a big section with a general heading, or a small task section, is left alone', () => {
    expect(
      codes([agent('claude', [file('claude', 'CLAUDE.md', `# P\n\n${bigSection('Code style')}`)])]),
    ).toEqual([]);
    expect(
      codes([
        agent('claude', [file('claude', 'CLAUDE.md', '# P\n\n## Deploying\n\nRun deploy.sh.\n')]),
      ]),
    ).toEqual([]);
  });

  test('## headings inside code blocks do not start sections', () => {
    const text = `# P\n\n\`\`\`md\n## Deploying\n${'x y z '.repeat(900)}\n\`\`\`\n`;
    expect(codes([agent('claude', [file('claude', 'CLAUDE.md', text)])])).toEqual([]);
  });

  test('a skill-less tool above 5% of its window gets a trim suggestion', () => {
    const a = agent('cursor', [file('cursor', '.cursorrules', 'word '.repeat(10))], {
      contextTokens: 20_000,
      startup: { total: 4000 } as AgentReport['startup'],
      topFiles: [{ path: '.cursorrules', tokens: 4000, category: 'rules' }],
    });
    expect(checksOf([a])).toMatchObject([{ code: 'trim-startup', tool: 'cursor', tokens: 4000 }]);
  });

  test('no trim suggestion when small, when under 5%, or when the tool has skills', () => {
    const f = file('cursor', 'a.md', 'x');
    const mk = (total: number, ctx: number, items = [f]) =>
      agent('cursor', items, { contextTokens: ctx, startup: { total } as AgentReport['startup'] });
    expect(codes([mk(2000, 10_000)])).toEqual([]); // 20% but only 2k tokens
    expect(codes([mk(4000, 200_000)])).toEqual([]); // 2%
    const withSkill = [f, skill('cursor', 'a-skill', 'Use when testing the thing properly')];
    expect(codes([mk(30_000, 200_000, withSkill)])).toEqual([]);
  });
});

describe('skill health', () => {
  const GOOD = 'Review pull requests for security issues. Use when the user asks for a review.';

  test('a good description has no findings', () => {
    expect(codes([agent('claude', [skill('claude', 'review', GOOD)])])).toEqual([]);
  });

  test('missing description is a warning', () => {
    const [c] = checksOf([agent('claude', [skill('claude', 'empty', '')])]);
    expect(c).toMatchObject({
      code: 'skill-no-description',
      severity: 'warn',
      kind: 'skill-health',
    });
  });

  test('too short and generic descriptions are warnings; a missing trigger is only info', () => {
    const find = (d: string) => checksOf([agent('claude', [skill('claude', 's', d)])]);
    expect(find('Does stuff')[0]).toMatchObject({ code: 'skill-vague', severity: 'warn' });
    expect(find('A helper for various repository chores and things')[0]).toMatchObject({
      code: 'skill-vague',
      severity: 'warn',
    });
    expect(find('Summarises long documents into short bullet lists')[0]).toMatchObject({
      code: 'skill-no-trigger',
      severity: 'info',
    });
    expect(find('Summarises documents. Use when asked to summarise')).toEqual([]);
  });

  test('when_to_use counts as a trigger', () => {
    const s = skill('claude', 's', 'Summarises long documents into short lists', {
      whenToUse: 'asked to summarise',
    });
    expect(codes([agent('claude', [s])])).toEqual([]);
  });

  test('within 10% below the cut-off is flagged; far below and past it are not', () => {
    const desc = (n: number) => `Use when needed. ${'x'.repeat(n - 17)}`;
    const near = (n: number) =>
      codes([agent('claude', [skill('claude', 's', desc(n))])], { claude: 1000 });
    expect(near(950)).toContain('skill-near-cutoff');
    expect(near(900)).toContain('skill-near-cutoff');
    expect(near(850)).not.toContain('skill-near-cutoff');
    expect(near(1001)).not.toContain('skill-near-cutoff'); // already cut: reported as a drop
  });

  test('overlapping descriptions name both skills', () => {
    const a = skill(
      'claude',
      'pdf-a',
      'Extract text and tables from PDF files. Use when working with PDF files.',
    );
    const b = skill(
      'claude',
      'pdf-b',
      'Extract tables and text from PDF files. Use when working with PDF documents.',
    );
    const c = skill(
      'claude',
      'deploy',
      'Deploy the service to staging. Use when the user wants to ship.',
    );
    const checks = checksOf([agent('claude', [a, b, c])]);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ code: 'skill-overlap', severity: 'warn' });
    expect(checks[0]?.message).toContain('pdf-a');
    expect(checks[0]?.message).toContain('pdf-b');
  });

  test('a skill shared by two tools is checked once', () => {
    const items = (t: string) => [skill(t, 'empty', '', { path: '.agents/skills/empty/SKILL.md' })];
    const checks = checksOf([agent('codex', items('codex')), agent('opencode', items('opencode'))]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.tool).toBeUndefined();
  });

  test('the same skill defined in two folders is a duplicate, not an overlap', () => {
    const a = skill('claude', 'review', GOOD, { path: '.claude/skills/review/SKILL.md' });
    const b = skill('claude', 'review', GOOD, { path: '.agents/skills/review/SKILL.md' });
    expect(codes([agent('claude', [a, b])])).toEqual(['duplicate-skill']);
  });
});

test('checks are sorted deterministically', () => {
  const agents = [agent('claude', [skill('claude', 'b', ''), skill('claude', 'a', '')])];
  const reversed = agents.map((a) => ({ ...a, items: [...a.items].reverse() }));
  expect(checksOf(agents)).toEqual(checksOf(reversed));
});

describe('end to end', () => {
  const text = `# Rules\n\n${SENTENCE}\n\nUse pnpm for installing dependencies, never npm or yarn.\n`;
  const repo = () => tmpRepo({ '.git/': '', 'AGENTS.md': text, 'CLAUDE.md': text });

  test('analyze() finds a duplicated CLAUDE.md and AGENTS.md', async () => {
    const report = await analyze({ cwd: repo(), agents: ['claude', 'codex'] });
    expect(report.checks.map((c) => c.code)).toContain('duplicate-file');
    const off = await analyze({ cwd: repo(), agents: ['claude', 'codex'], checks: false });
    expect(off.checks).toEqual([]);
  });

  async function cli(argv: string[], cwd: string) {
    let stdout = '';
    const code = await run(argv, {
      stdout: (t) => {
        stdout += t;
      },
      stderr: () => {},
      env: {},
      isTTY: false,
      cwd,
    });
    return { code, stdout };
  }

  test('--json has checks, the terminal prints a Checks section, --no-checks removes both', async () => {
    const dir = repo();
    const json = JSON.parse((await cli(['--json'], dir)).stdout);
    expect(json.checks.some((c: { code: string }) => c.code === 'duplicate-file')).toBe(true);
    const term = await cli([], dir);
    expect(term.code).toBe(EXIT.ok);
    expect(term.stdout).toContain('Checks');
    expect(term.stdout).toContain('are identical');
    const off = JSON.parse((await cli(['--json', '--no-checks'], dir)).stdout);
    expect(off.checks).toEqual([]);
    expect((await cli(['--no-checks'], dir)).stdout).not.toContain('Checks');
  });
});
