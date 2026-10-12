import path from 'node:path';
import { toPosixRel, walkFiles } from './core/fs.ts';
import type { Report, TreeRow } from './core/types.ts';

/** Folders listed at most; the rest are counted in the note, not analysed. */
export const TREE_LIMIT = 30;

/** Well-known instruction file names, so a nested one is found even when no selected tool loads it from the root. */
const INSTRUCTION_NAMES = new Set([
  'AGENTS.md',
  'AGENTS.override.md',
  'CLAUDE.md',
  'CLAUDE.local.md',
  'GEMINI.md',
  '.cursorrules',
  '.windsurfrules',
  '.rules',
  'CONVENTIONS.md',
]);

/** Dot-folders that hold agent config; the folder that contains them is the one that matters. */
const startsWithDot = (segment: string) => segment.startsWith('.');

/**
 * Folders where a tool could pick up nested instructions: every folder that holds a
 * project file one of the tools found (AGENTS.md, a nested .cursor/rules, a subfolder
 * CLAUDE.md, ...). The repo root is always first.
 */
export function candidateDirs(report: Report, root?: string): { dirs: string[]; skipped: number } {
  const found = new Set<string>();
  if (root) {
    for (const abs of walkFiles(root)) {
      if (!INSTRUCTION_NAMES.has(path.basename(abs))) continue;
      const dir = path.posix.dirname(toPosixRel(root, abs));
      if (dir !== '.') found.add(dir);
    }
  }
  for (const agent of report.agents) {
    for (const item of agent.items) {
      if (item.scope !== 'project' || item.path.startsWith('~/')) continue;
      const segments = item.path.split('/').slice(0, -1);
      const stop = segments.findIndex(startsWithDot);
      const dir = (stop === -1 ? segments : segments.slice(0, stop)).join('/');
      if (dir !== '') found.add(dir);
    }
  }
  const sorted = [...found].sort(
    (a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : a > b ? 1 : 0),
  );
  return {
    dirs: ['.', ...sorted.slice(0, TREE_LIMIT - 1)],
    skipped: Math.max(0, sorted.length - (TREE_LIMIT - 1)),
  };
}

/**
 * Re-runs the analysis with each candidate folder as the starting directory and records
 * every tool's startup tokens. `analyzeAt` runs one analysis with the same options as the
 * main run, only with a different cwd.
 */
export async function analyzeTree(
  base: Report,
  root: string,
  analyzeAt: (cwd: string) => Promise<Report>,
): Promise<{ rows: TreeRow[]; skipped: number }> {
  const { dirs, skipped } = candidateDirs(base, root);
  const rows: TreeRow[] = [];
  for (const dir of dirs) {
    const report = dir === '.' ? base : await analyzeAt(path.join(root, ...dir.split('/')));
    rows.push({
      dir,
      tools: Object.fromEntries(report.agents.map((a) => [a.agent, a.startup.total])),
    });
  }
  return { rows, skipped };
}
