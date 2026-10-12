import { expect, test, vi } from 'vitest';
import { analyze } from '../../src/core/analyze.ts';
import { AGENT_IDS } from '../../src/core/types.ts';
import { tmpRepo } from '../helpers.ts';

vi.mock('../../src/agents/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/agents/index.ts')>();
  const base = { scope: 'project', reason: 'test', importedFrom: undefined } as const;
  return {
    loaders: {
      ...real.loaders,
      codex: async () => ({
        items: [
          {
            ...base,
            agent: 'codex',
            path: 'b.md',
            category: 'rules',
            load: 'on-demand',
            text: 'on demand text',
            bytes: 14,
            order: 2,
          },
          {
            ...base,
            agent: 'codex',
            path: 'a.md',
            category: 'instructions',
            load: 'startup',
            text: 'hello world',
            bytes: 11,
            order: 1,
          },
          {
            ...base,
            agent: 'codex',
            path: 'c.md',
            category: 'rules',
            load: 'ignored',
            text: 'ignored',
            bytes: 7,
            order: 3,
          },
        ],
        warnings: [{ agent: 'codex', message: 'w' }],
      }),
    },
  };
});

test('empty repo gives every agent a zero report with no absolute paths', async () => {
  const repo = tmpRepo({ '.git/': '' });
  const report = await analyze({ cwd: repo, agents: AGENT_IDS.filter((a) => a !== 'codex') });
  expect(report.root).toBe('.');
  expect(report.tokenizer).toBe('o200k_base (estimate)');
  expect(report.agents.map((a) => a.startup.total)).toEqual([0, 0, 0, 0]);
  expect(JSON.stringify(report)).not.toContain(repo.replaceAll('\\', '\\\\'));
});

test('counts tokens, sorts by order and splits startup from on-demand', async () => {
  const repo = tmpRepo({ '.git/': '' });
  const [codex] = (await analyze({ cwd: repo, agents: ['codex'], contextTokens: 1000 })).agents;
  expect(codex?.items.map((i) => i.path)).toEqual(['a.md', 'b.md', 'c.md']);
  expect(codex?.startup).toEqual({
    total: 2,
    byCategory: { instructions: 2, rules: 0, skills: 0, memory: 0 },
  });
  expect(codex?.onDemand.count).toBe(1);
  expect(codex?.contextTokens).toBe(1000);
  expect(codex?.warnings).toHaveLength(1);
});
