import { expect, test, vi } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { tmpRepo } from './helpers.ts';

vi.setConfig({ testTimeout: 30_000 });

// 30 skills with a long description: about 12,000 characters of listing in all.
const skills = Object.fromEntries(
  Array.from({ length: 30 }, (_, n) => [
    `.agents/skills/s${n}/SKILL.md`,
    `---\nname: s${n}\ndescription: ${'Use when the thing happens and you need to do the other thing carefully. '.repeat(5)}\n---\nBody\n`,
  ]),
);

test('Codex skill descriptions are cut for certain only when the context window was given', async () => {
  const dir = tmpRepo({ '.git/': '', ...skills });
  const assumed = await analyze({ cwd: dir, root: dir, agents: ['codex'] });
  const cut = assumed.agents[0]?.drops.filter((d) => d.kind === 'skill-description-truncated');
  expect(cut?.length).toBeGreaterThan(0);
  // The 8,000-character budget applies only when the window is unknown: so this is a risk, not a fact.
  expect(cut?.every((d) => d.certainty === 'at-risk')).toBe(true);

  const given = await analyze({
    cwd: dir,
    root: dir,
    agents: ['codex'],
    contextTokens: 50_000, // 2% of it is 1,000 tokens: well under the listing
  });
  const sure = given.agents[0]?.drops.filter((d) => d.kind === 'skill-description-truncated');
  expect(sure?.length).toBeGreaterThan(0);
  expect(sure?.every((d) => d.certainty === 'will')).toBe(true);
});
