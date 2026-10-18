import { describe, expect, test } from 'vitest';
import { byteLength, countTokens, tokenizerLabel } from '../../src/core/tokenize.ts';

describe('countTokens', () => {
  test('empty string is 0', () => {
    expect(countTokens('')).toBe(0);
  });

  test('matches known o200k_base counts', () => {
    expect(countTokens('hello world')).toBe(2);
    expect(countTokens('# CLAUDE.md\n\nUse pnpm.\n')).toBeGreaterThan(3);
  });

  test('does not treat special tokens as special', () => {
    expect(() => countTokens('<|endoftext|>')).not.toThrow();
    expect(countTokens('<|endoftext|>')).toBeGreaterThan(1);
  });
});

test('byteLength counts UTF-8 bytes', () => {
  expect(byteLength('é')).toBe(2);
  expect(byteLength('abc')).toBe(3);
});

describe('long input', () => {
  test('a 100 KB run of one character counts quickly', () => {
    const start = performance.now();
    expect(countTokens('x'.repeat(100 * 1024))).toBe(12_800);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  test('text around a repeated run is still counted', () => {
    const run = '='.repeat(300);
    expect(countTokens(`intro ${run} outro`)).toBeGreaterThan(countTokens(run) + 1);
  });

  test('90 KB of prose counts quickly', () => {
    const start = performance.now();
    expect(countTokens('The quick brown fox jumps over the lazy dog.\n'.repeat(2000))).toBe(20_000);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

test('tokenizerLabel names named tokenizers and estimates', () => {
  expect(tokenizerLabel('o200k_base')).toBe('o200k_base');
  expect(tokenizerLabel({ charsPerToken: 3.5 })).toBe('~3.5 chars per token');
});

test('an estimated tokenizer counts characters, not UTF-16 units, and rounds up', () => {
  expect(countTokens('😀😀😀😀', { charsPerToken: 2 })).toBe(2);
  expect(countTokens('abc', { charsPerToken: 2 })).toBe(2);
  expect(countTokens('', { charsPerToken: 2 })).toBe(0);
});
