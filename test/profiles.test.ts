import { expect, test } from 'vitest';
import { AGENT_IDS } from '../src/core/types.ts';
import { profiles } from '../src/profiles.ts';

test('every agent has a profile', () => {
  expect(Object.keys(profiles).sort()).toEqual([...AGENT_IDS].sort());
});

test.each(AGENT_IDS)('%s cites https sources with a checked date', (id) => {
  const { sources } = profiles[id];
  expect(sources.length).toBeGreaterThan(0);
  for (const source of sources) {
    expect(source.url).toMatch(/^https:\/\//);
    expect(source.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
});
