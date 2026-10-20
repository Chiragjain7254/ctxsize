import { expect, test } from 'vitest';
import { skillEntry } from '../../src/core/items.ts';

test('skillEntry formats a skill as "- name: description"', () => {
  expect(skillEntry('deploy', 'Ships the app')).toBe('- deploy: Ships the app\n');
});

test('skillEntry leaves out the colon when there is no description', () => {
  expect(skillEntry('deploy', '')).toBe('- deploy\n');
});
