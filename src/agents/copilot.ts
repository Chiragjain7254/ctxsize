import path from 'node:path';
import { parseFrontmatter, stringField } from '../core/frontmatter.ts';
import { ancestors, fileExists, readText, toPosixRel, walkFiles } from '../core/fs.ts';
import { makeItem, warn } from '../core/items.ts';
import type { Load, Loader, LoaderContext, LoaderItem, Warning } from '../core/types.ts';
import { profiles } from '../profiles.ts';

// Models GitHub Copilot's cloud agent (profiles.copilot.surface). Sources:
// https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
// https://docs.github.com/en/copilot/reference/custom-instructions-support
// Personal instructions under ~/.copilot/ are read by Copilot CLI only, not the cloud agent,
// so the home directory is never consulted here.

const AGENT = 'copilot';
const SURFACE = profiles.copilot.surface;
const INSTRUCTIONS_SUFFIX = '.instructions.md';
/** applyTo values that match every file, so the file is effectively always applied. */
const ALL_FILES = new Set(['**', '**/*']);

export const load: Loader = async (ctx) => {
  const items: LoaderItem[] = [];
  const warnings: Warning[] = [];
  let order = 0;

  const push = (
    abs: string,
    text: string,
    category: LoaderItem['category'],
    load: Load,
    reason: string,
  ): void => {
    items.push(makeItem(ctx, AGENT, abs, text, { category, load, reason, order: order++ }));
  };

  // 1. Repository-wide instructions.
  const github = path.join(ctx.root, '.github');
  const repoWide = readExact(github, 'copilot-instructions.md');
  if (repoWide)
    push(repoWide.abs, repoWide.text, 'instructions', 'startup', 'repository-wide instructions');

  // 2. AGENTS.md: "the nearest AGENTS.md in the directory tree takes precedence".
  const agentsStartup = loadAgentsMd(ctx, push);

  // 3. Root CLAUDE.md / GEMINI.md, documented as an alternative to AGENTS.md.
  for (const name of ['CLAUDE.md', 'GEMINI.md']) {
    const file = readExact(ctx.root, name);
    if (!file) continue;
    push(file.abs, file.text, 'instructions', 'startup', `root ${name} (read by cloud agent)`);
    if (agentsStartup) {
      warnings.push(
        warn(
          ctx,
          AGENT,
          file.abs,
          'docs do not say whether CLAUDE.md/GEMINI.md load alongside AGENTS.md; counted as loaded',
        ),
      );
    }
  }

  // 4. Path-specific instructions.
  for (const abs of walkFiles(path.join(github, 'instructions'))) {
    if (!path.basename(abs).endsWith(INSTRUCTIONS_SUFFIX)) continue;
    const raw = readText(abs);
    if (raw === undefined) continue;
    const fm = parseFrontmatter(raw);
    if (fm.error) warnings.push(warn(ctx, AGENT, abs, fm.error));
    const { load, reason } = classifyInstructions(fm.data);
    push(abs, fm.body, 'rules', load, reason);
  }

  return { items, warnings };
};

function readExact(dir: string, name: string): { abs: string; text: string } | undefined {
  if (!fileExists(dir, name)) return undefined;
  const abs = path.join(dir, name);
  const text = readText(abs);
  return text === undefined ? undefined : { abs, text };
}

function classifyInstructions(data: Record<string, unknown>): { load: Load; reason: string } {
  const exclude = data.excludeAgent;
  const excluded = Array.isArray(exclude)
    ? exclude.some((v) => String(v).trim() === SURFACE)
    : typeof exclude === 'string' && exclude.trim() === SURFACE;
  if (excluded) return { load: 'ignored', reason: `excludeAgent: ${SURFACE}` };

  const applyTo = stringField(data, 'applyTo')?.trim();
  if (!applyTo) return { load: 'ignored', reason: 'no applyTo: never applied' };
  const globs = applyTo.split(',').map((g) => g.trim());
  if (globs.some((g) => ALL_FILES.has(g))) {
    return { load: 'startup', reason: `applyTo: ${applyTo} (all files)` };
  }
  return { load: 'on-demand', reason: `applyTo: ${applyTo}` };
}

/** Emits every AGENTS.md; returns true when one loads at startup. */
function loadAgentsMd(
  ctx: LoaderContext,
  push: (abs: string, text: string, category: 'instructions', load: Load, reason: string) => void,
): boolean {
  let startup = false;
  // cwd first, so the nearest file is the one that wins.
  for (const dir of ancestors(ctx.cwd, ctx.root)) {
    const file = readExact(dir, 'AGENTS.md');
    if (!file) continue;
    if (startup) {
      push(file.abs, file.text, 'instructions', 'ignored', 'shadowed by nearer AGENTS.md');
    } else {
      push(file.abs, file.text, 'instructions', 'startup', 'nearest AGENTS.md');
      startup = true;
    }
  }
  // Below cwd: each becomes the nearest one only when work happens in its directory.
  for (const abs of walkFiles(ctx.cwd)) {
    if (path.basename(abs) !== 'AGENTS.md') continue;
    const dir = path.dirname(abs);
    if (dir === path.resolve(ctx.cwd)) continue;
    const file = readExact(dir, 'AGENTS.md');
    if (!file) continue;
    push(
      file.abs,
      file.text,
      'instructions',
      'on-demand',
      `nearest when working in ${toPosixRel(ctx.root, dir)}`,
    );
  }
  return startup;
}
