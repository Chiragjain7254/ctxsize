// Bugs found while writing the integration tests. Each test states the correct behaviour
// and is marked test.fails until src is fixed; when a fix lands, vitest reports the test as
// unexpectedly passing, and the .fails marker should be removed.
import path from 'node:path';
import { expect, test } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { fakeHome, tmpRepo } from './helpers.ts';

// BUG: an @import that points outside the repo is read even without --include-user, and its
// path is printed as an absolute machine path (src/core/fs.ts:26 displayPath fallback, reached
// from src/core/imports.ts:71). This leaks the user's directory layout into the report and
// makes JSON differ between machines. Common in monorepos: CLAUDE.md with @../shared.md.
test.fails('an import outside the repo never shows an absolute path', async () => {
  const outer = tmpRepo({
    'shared.md': 'shared rules\n',
    'repo/.git/': '',
    'repo/CLAUDE.md': '# Repo\n\n@../shared.md\n',
  });
  const report = await analyze({ cwd: path.join(outer, 'repo'), agents: ['claude', 'gemini'] });
  const json = JSON.stringify(report);
  expect(json).not.toContain(path.basename(outer));
  for (const a of report.agents) {
    for (const i of a.items)
      expect(path.posix.isAbsolute(i.path) || /^[A-Za-z]:/.test(i.path)).toBe(false);
  }
});

// SUSPECTED BUG (verify against codex-rs agents_md.rs): the global ~/.codex/AGENTS.md is
// Codex's user_instructions and is joined to the project docs after the project docs are
// read under project_doc_max_bytes; it does not use up that 32 KiB budget. The simulator
// counts it (src/simulate.ts:187, it is the first 'startup' instructions item from
// src/agents/codex.ts:27), so a 10 KiB project AGENTS.md is reported as cut to 2 KiB.
test('global ~/.codex/AGENTS.md does not eat the project AGENTS.md budget', async () => {
  const home = fakeHome({ '.codex/AGENTS.md': 'g'.repeat(30 * 1024) });
  const repo = tmpRepo({ '.git/': '', 'AGENTS.md': 'p'.repeat(10 * 1024) });
  const [codex] = (await analyze({ cwd: repo, agents: ['codex'], home })).agents;
  expect(codex?.drops).toEqual([]);
  expect(codex?.items.find((i) => i.path === 'AGENTS.md')?.bytes).toBe(10 * 1024);
});

// GAP: Cursor documents nested .cursor/rules directories that attach when files in their
// directory are referenced. From the repo root the loader only reads .cursor/rules on the
// root..cwd chain (src/agents/cursor.ts:78), so packages/x/.cursor/rules is missing from the
// report entirely instead of being listed as on-demand.
test.fails('nested .cursor/rules below cwd are listed as on-demand', async () => {
  const repo = tmpRepo({
    '.git/': '',
    'packages/x/.cursor/rules/nested.mdc': '---\nalwaysApply: true\n---\nNested rule.\n',
  });
  const [cursor] = (await analyze({ cwd: repo, agents: ['cursor'] })).agents;
  const nested = cursor?.items.find((i) => i.path === 'packages/x/.cursor/rules/nested.mdc');
  expect(nested?.load).toBe('on-demand');
});
