import { expect, test } from 'vitest';
import { VERSION } from '../src/version.ts';

test('exports a semver version', () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
});
