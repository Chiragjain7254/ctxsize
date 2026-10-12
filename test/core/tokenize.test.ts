import { describe, expect, test } from 'vitest';
import { byteLength, countTokens } from '../../src/core/tokenize.ts';

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
