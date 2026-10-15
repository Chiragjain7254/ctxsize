import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { countTokens, tokenCache } from '../src/core/tokenize.ts';
import { tmpRepo } from './helpers.ts';

beforeEach(() => tokenCache.clear());
afterEach(() => {
  tokenCache.limit = 20_000;
});

describe('countTokens cache', () => {
  test('a repeated text is counted once and gives the same number', () => {
    const text = 'Run the tests before every commit. '.repeat(30);
    const first = countTokens(text);
    expect([tokenCache.hits, tokenCache.misses]).toEqual([0, 1]);
    expect(countTokens(text)).toBe(first);
    expect([tokenCache.hits, tokenCache.misses]).toEqual([1, 1]);
  });

  test('a cached count equals a fresh one', () => {
    const text = 'Use pnpm. Two-space indent. No default exports.\n'.repeat(10);
    const fresh = countTokens(text);
    tokenCache.clear();
    expect(countTokens(text)).toBe(fresh);
  });

  test('a changed text is counted again, and each tokenizer has its own entry', () => {
    countTokens('hello world');
    countTokens('hello world!');
    countTokens('hello world', 'cl100k_base');
    expect(tokenCache.misses).toBe(3);
    expect(tokenCache.size).toBe(3);
  });

  test('empty text and the characters-per-token ratio never touch the cache', () => {
    countTokens('');
    countTokens('some text here', { charsPerToken: 3.5 });
    expect(tokenCache.size).toBe(0);
    expect(tokenCache.misses).toBe(0);
  });

  test('keeps a hash, not the text', () => {
    countTokens('secret instructions '.repeat(100));
    const [key] = [...tokenCache.counts.keys()];
    expect(key?.length).toBeLessThan(50);
    expect(key).not.toContain('secret');
  });

  test('drops the oldest entries past the limit', () => {
    tokenCache.limit = 2;
    countTokens('one');
    countTokens('two');
    countTokens('three');
    expect(tokenCache.size).toBe(2);
    tokenCache.misses = 0;
    countTokens('one'); // was evicted
    expect(tokenCache.misses).toBe(1);
    countTokens('three'); // still there
    expect(tokenCache.misses).toBe(1);
  });
});

describe('analyzing the same repo again, as --watch and --serve do', () => {
  const files = {
    '.git/': '',
    'AGENTS.md': `# Agents\n\n${'Run the tests before every commit. '.repeat(20)}\n`,
    'CLAUDE.md': '# Claude\n\nUse pnpm.\n',
    '.cursor/rules/a.mdc': '---\nalwaysApply: true\n---\nBe kind.\n',
    '.claude/skills/x/SKILL.md': '---\nname: x\ndescription: Does x. Use when x.\n---\nBody\n',
  };

  test('nothing is tokenized again when no file changed', async () => {
    const root = tmpRepo(files);
    const first = await analyze({ cwd: root });
    expect(tokenCache.misses).toBeGreaterThan(0);
    tokenCache.misses = 0;
    tokenCache.hits = 0;
    const second = await analyze({ cwd: root });
    expect(tokenCache.misses).toBe(0);
    expect(tokenCache.hits).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  test('only the file that changed is tokenized again, and the totals follow it', async () => {
    const root = tmpRepo(files);
    const before = await analyze({ cwd: root, agents: ['codex'] });
    tokenCache.misses = 0;
    writeFileSync(
      path.join(root, 'AGENTS.md'),
      `${files['AGENTS.md']}\nOne more rule to follow.\n`,
    );
    const after = await analyze({ cwd: root, agents: ['codex'] });
    expect(tokenCache.misses).toBe(1);
    expect(after.agents[0]?.startup.total).toBeGreaterThan(before.agents[0]?.startup.total ?? 0);
  });

  test('a file changed back to an earlier text is a hit', async () => {
    const root = tmpRepo(files);
    await analyze({ cwd: root, agents: ['codex'] });
    writeFileSync(path.join(root, 'AGENTS.md'), '# Changed\n');
    await analyze({ cwd: root, agents: ['codex'] });
    tokenCache.misses = 0;
    writeFileSync(path.join(root, 'AGENTS.md'), files['AGENTS.md']);
    await analyze({ cwd: root, agents: ['codex'] });
    expect(tokenCache.misses).toBe(0);
  });
});
