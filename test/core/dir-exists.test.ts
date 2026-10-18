import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { dirExists } from '../../src/core/fs.ts';
import { tmpRepo } from '../helpers.ts';

test('dirExists is true for a folder, false for a file or a missing path', () => {
  const root = tmpRepo({});
  writeFileSync(path.join(root, 'file.txt'), 'x');
  expect(dirExists(root)).toBe(true);
  expect(dirExists(path.join(root, 'file.txt'))).toBe(false);
  expect(dirExists(path.join(root, 'missing'))).toBe(false);
});
