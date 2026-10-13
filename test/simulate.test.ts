import { describe, expect, test } from 'vitest';
import { countTokens } from '../src/core/tokenize.ts';
import type { AgentId, Category, LoadedItem } from '../src/core/types.ts';
import { simulate, truncateUtf8 } from '../src/simulate.ts';

let order = 0;
function item(
  agent: AgentId,
  path: string,
  text: string,
  extra: Partial<LoadedItem> = {},
): LoadedItem {
  return {
    agent,
    path,
    scope: 'project',
    category: 'instructions' as Category,
    load: 'startup',
    reason: 'test',
    text,
    bytes: Buffer.byteLength(text),
    tokens: countTokens(text),
    order: order++,
    ...extra,
  };
}

function skill(agent: AgentId, name: string, description: string, whenToUse?: string): LoadedItem {
  const combined = [description, whenToUse].filter(Boolean).join(' ');
  return item(agent, `.skills/${name}/SKILL.md`, `- ${name}: ${combined}\n`, {
    category: 'skills',
    skill: {
      name,
      description,
      bodyPath: `.skills/${name}/SKILL.md`,
      ...(whenToUse ? { whenToUse } : {}),
    },
  });
}

const run = (
  agent: AgentId,
  items: LoadedItem[],
  opts: Partial<{ contextTokens: number; contextGiven: boolean; env: Record<string, string> }> = {},
) => simulate({ agent, items, contextTokens: 200_000, contextGiven: false, env: {}, ...opts });

const KiB = 1024;

describe('truncateUtf8', () => {
  test('never splits a multi-byte character', () => {
    expect(truncateUtf8('aé', 2)).toBe('a');
    expect(truncateUtf8('aé', 3)).toBe('aé');
    expect(truncateUtf8('😀😀', 5)).toBe('😀');
  });
});

describe('codex AGENTS.md 32 KiB limit', () => {
  test('cuts the file that crosses the limit and drops later files', () => {
    const items = [
      item('codex', 'AGENTS.md', 'a'.repeat(20 * KiB)),
      item('codex', 'pkg/AGENTS.md', 'b'.repeat(20 * KiB)),
      item('codex', 'pkg/sub/AGENTS.md', 'c'.repeat(100)),
    ];
    const r = run('codex', items);
    expect(r.drops.map((d) => [d.kind, d.path, d.bytesLost, d.certainty])).toEqual([
      ['file-truncated', 'pkg/AGENTS.md', 8 * KiB, 'will'],
      ['file-dropped', 'pkg/sub/AGENTS.md', 100, 'will'],
    ]);
    const kept = r.items.filter((i) => i.load === 'startup');
    expect(kept.reduce((s, i) => s + i.bytes, 0)).toBe(32 * KiB);
    expect(r.items[1]?.tokens).toBe(countTokens('b'.repeat(12 * KiB)));
    expect(r.items[2]?.load).toBe('ignored');
  });

  test('exactly 32 KiB loses nothing', () => {
    expect(run('codex', [item('codex', 'AGENTS.md', 'a'.repeat(32 * KiB))]).drops).toEqual([]);
  });

  test('does not mutate the input items', () => {
    const input = [item('codex', 'AGENTS.md', 'a'.repeat(40 * KiB))];
    run('codex', input);
    expect(input[0]?.bytes).toBe(40 * KiB);
  });

  test('on-demand and ignored files do not use the budget', () => {
    const r = run('codex', [
      item('codex', 'x.md', 'a'.repeat(40 * KiB), { load: 'ignored' }),
      item('codex', 'AGENTS.md', 'a'.repeat(10)),
    ]);
    expect(r.drops).toEqual([]);
  });
});

describe('codex skill listing', () => {
  const many = (n: number, desc: string) =>
    Array.from({ length: n }, (_, i) =>
      skill('codex', `skill-${String(i).padStart(3, '0')}`, desc),
    );

  test('under the 8,000-char fallback: no drops, a note about the fallback', () => {
    const r = run('codex', many(5, 'short'));
    expect(r.drops).toEqual([]);
    expect(r.notes.join()).toMatch(/8,000 chars/);
  });

  test('over budget: descriptions are shortened first, every skill still listed', () => {
    const r = run('codex', many(40, 'x'.repeat(400)));
    expect(r.drops.every((d) => d.kind === 'skill-description-truncated')).toBe(true);
    expect(r.drops).toHaveLength(40);
    const listing = r.items
      .filter((i) => i.load === 'startup')
      .reduce((s, i) => s + i.text.length, 0);
    expect(listing).toBeLessThanOrEqual(8000);
  });

  test('still over with names only: the last skills in discovery order are omitted', () => {
    const r = run('codex', many(800, 'desc'));
    const omitted = r.drops.filter((d) => d.kind === 'skill-omitted');
    expect(omitted.length).toBeGreaterThan(0);
    expect(omitted[0]?.skill).toBe('skill-799');
    const listing = r.items
      .filter((i) => i.load === 'startup')
      .reduce((s, i) => s + i.text.length, 0);
    expect(listing).toBeLessThanOrEqual(8000);
  });

  test('--context switches to 2% of the window in tokens', () => {
    const r = run('codex', many(40, 'x'.repeat(400)), {
      contextTokens: 1_000_000,
      contextGiven: true,
    });
    expect(r.drops).toEqual([]);
    expect(r.notes).toEqual([]);
  });
});

describe('claude skills', () => {
  test('description + when_to_use over 1,536 chars is cut', () => {
    const r = run('claude', [skill('claude', 'big', 'd'.repeat(1500), 'w'.repeat(500))]);
    const [drop] = r.drops;
    expect(drop?.kind).toBe('skill-description-truncated');
    expect(drop?.certainty).toBe('will');
    expect(drop?.bytesLost).toBe(1500 + 1 + 500 - 1536);
    expect(r.items[0]?.text).toBe(`- big: ${'d'.repeat(1500)} ${'w'.repeat(35)}\n`);
  });

  test('listing over 1% of context marks every description at risk with a K of N note', () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      skill('claude', `s${i}`, 'word '.repeat(80)),
    );
    const r = run('claude', items);
    const atRisk = r.drops.filter((d) => d.kind === 'skill-description-dropped');
    expect(atRisk).toHaveLength(30);
    expect(atRisk.every((d) => d.certainty === 'at-risk')).toBe(true);
    expect(r.notes[0]).toMatch(/At least \d+ of 30 skill descriptions/);
    // At-risk drops do not change what is counted.
    expect(r.items.every((i) => i.load === 'startup')).toBe(true);
  });

  test('under budget: no drops', () => {
    expect(run('claude', [skill('claude', 'a', 'small')]).drops).toEqual([]);
  });

  test('a smaller --context halves the budget and tips it over', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      skill('claude', `s${i}`, 'word '.repeat(30)),
    );
    const total = items.reduce((s, i) => s + i.tokens, 0);
    // Choose a window where the full listing fits, then halve it.
    const fits = Math.ceil(total / 0.01);
    expect(run('claude', items, { contextTokens: fits }).drops).toEqual([]);
    expect(run('claude', items, { contextTokens: Math.floor(fits / 2) }).drops.length).toBe(10);
  });

  test('120 skills with long descriptions: every description is at risk, in memory', () => {
    const desc = (n: number) =>
      `Skill number ${n} handles a very specific workflow in this repository, including setup, ` +
      'validation, migration, rollback, reporting and every edge case the team has hit so far.';
    const items = Array.from({ length: 120 }, (_, n) => skill('claude', `skill-${n}`, desc(n)));
    items[0] = skill('claude', 'skill-0', 'long '.repeat(400));
    const r = run('claude', items);
    expect(r.notes[0]).toContain('of 120 skill descriptions will be dropped');
    expect(r.notes[0]).toContain('1% of 200,000 context');
    const atRisk = r.drops.filter((d) => d.kind === 'skill-description-dropped');
    expect(atRisk).toHaveLength(120);
    for (const d of atRisk) expect(d.certainty).toBe('at-risk');
    const cut = r.drops.filter((d) => d.kind === 'skill-description-truncated');
    expect(cut.map((d) => d.skill)).toEqual(['skill-0']);
  });

  test('SLASH_COMMAND_TOOL_CHAR_BUDGET switches the budget to characters', () => {
    const items = [skill('claude', 'a', 'x'.repeat(300)), skill('claude', 'b', 'x'.repeat(300))];
    const r = run('claude', items, { env: { SLASH_COMMAND_TOOL_CHAR_BUDGET: '500' } });
    expect(r.notes[0]).toMatch(/chars.*SLASH_COMMAND_TOOL_CHAR_BUDGET=500/);
    expect(r.notes[0]).toMatch(/At least 1 of 2/);
  });
});

describe('claude MEMORY.md', () => {
  test('only the first 200 lines load', () => {
    const text = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
    const r = run('claude', [item('claude', 'MEMORY.md', text, { category: 'memory' })]);
    expect(r.items[0]?.text.split('\n')).toHaveLength(200);
    expect(r.drops[0]).toMatchObject({ kind: 'file-truncated', limit: 'claude.memoryMaxLines' });
  });

  test('only the first 25 KB load', () => {
    const r = run('claude', [
      item('claude', 'MEMORY.md', 'x'.repeat(30 * KiB), { category: 'memory' }),
    ]);
    expect(r.items[0]?.bytes).toBe(25 * KiB);
    expect(r.drops[0]).toMatchObject({ bytesLost: 5 * KiB, limit: 'claude.memoryMaxBytes' });
  });
});

describe('cursor', () => {
  test('a 600-line rule is advice only and still counted', () => {
    const text = 'rule\n'.repeat(600);
    const r = run('cursor', [item('cursor', '.cursor/rules/big.mdc', text, { category: 'rules' })]);
    expect(r.drops).toEqual([
      expect.objectContaining({ kind: 'over-recommended-size', certainty: 'advice' }),
    ]);
    expect(r.items[0]?.load).toBe('startup');
  });

  test('exactly 500 lines is fine', () => {
    const r = run('cursor', [item('cursor', 'r.mdc', 'rule\n'.repeat(500), { category: 'rules' })]);
    expect(r.drops).toEqual([]);
  });

  test('legacy .cursorrules is flagged at risk', () => {
    const r = run('cursor', [
      item('cursor', '.cursorrules', 'x', { category: 'rules', reason: 'legacy .cursorrules' }),
    ]);
    expect(r.drops[0]).toMatchObject({ kind: 'legacy', certainty: 'at-risk' });
  });
});

test('copilot notes the modelled surface; gemini has no limits', () => {
  expect(run('copilot', []).notes[0]).toMatch(/cloud-agent/);
  expect(run('gemini', [item('gemini', 'GEMINI.md', 'x'.repeat(100 * KiB))]).drops).toEqual([]);
});
