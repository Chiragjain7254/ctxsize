import path from 'node:path';
import { ancestors, displayPath, fileExists, isInside, readText } from '../core/fs.ts';
import { makeItem, readSkillsDir } from '../core/items.ts';
import type { Loader, LoaderContext, LoaderItem, Warning } from '../core/types.ts';

// Codex CLI: one instruction file per directory (global, then repo root down to cwd),
// plus a name + description listing for every skill. Limits are applied by the simulator.
// Sources: see profiles.codex (agents-md docs, build-skills docs, codex-rs agents_md.rs).

const OVERRIDE = 'AGENTS.override.md';
const DEFAULT = 'AGENTS.md';

export const load: Loader = async (ctx) => {
  const items: LoaderItem[] = [];
  const warnings: Warning[] = [];
  let order = 0;
  const codexHome = ctx.home ? codexHomeDir(ctx) : undefined;

  // Global: ~/.codex (or $CODEX_HOME), only when the user's setup is included.
  if (codexHome) {
    for (const pick of pickInDir(codexHome, [OVERRIDE, DEFAULT])) {
      const where = displayPath(codexHome, ctx);
      items.push(
        makeItem(ctx, 'codex', pick.abs, pick.text, {
          category: 'instructions',
          load: pick.loser ? 'ignored' : 'startup',
          reason: pick.loser ?? `global ${pick.name} in ${where}`,
          order: order++,
        }),
      );
    }
  }

  // Project: repo root down to cwd, first non-empty candidate per directory.
  const candidates = unique([OVERRIDE, DEFAULT, ...fallbackNames(codexHome)]);
  for (const dir of ancestors(ctx.cwd, ctx.root).reverse()) {
    const rel = displayPath(dir, ctx);
    for (const pick of pickInDir(dir, candidates)) {
      items.push(
        makeItem(ctx, 'codex', pick.abs, pick.text, {
          category: 'instructions',
          load: pick.loser ? 'ignored' : 'startup',
          reason: pick.loser ?? (rel === '.' ? `${pick.name} (root)` : `${pick.name} in ${rel}`),
          order: order++,
        }),
      );
    }
  }

  // Skills: name + description listing, in scan order, each directory once.
  const seen = new Set<string>();
  for (const dir of skillDirs(ctx)) {
    const key = path.resolve(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    const found = readSkillsDir(ctx, 'codex', dir);
    warnings.push(...found.warnings);
    for (const skill of found.skills) {
      items.push(
        makeItem(ctx, 'codex', skill.abs, `- ${skill.name}: ${skill.description}\n`, {
          category: 'skills',
          load: 'startup',
          reason: 'skill listing entry',
          order: order++,
          skill: { name: skill.name, description: skill.description, bodyAbs: skill.abs },
        }),
      );
    }
  }

  return { items, warnings };
};

function codexHomeDir(ctx: LoaderContext): string | undefined {
  if (!ctx.home) return undefined;
  const custom = ctx.env.CODEX_HOME?.trim();
  return custom ? path.resolve(custom) : path.join(ctx.home, '.codex');
}

interface Pick {
  abs: string;
  name: string;
  text: string;
  /** Set when another file in the same directory wins; the reason it is ignored. */
  loser?: string;
}

/**
 * The first existing, non-whitespace-only candidate wins; later non-empty candidates
 * are reported as shadowed. Whitespace-only files are skipped entirely, as Codex does.
 */
function pickInDir(dir: string, names: string[]): Pick[] {
  const picks: Pick[] = [];
  let winner: string | undefined;
  for (const name of names) {
    if (!fileExists(dir, name)) continue;
    const abs = path.join(dir, name);
    const text = readText(abs);
    if (text === undefined || text.trim() === '') continue;
    if (winner === undefined) {
      winner = name;
      picks.push({ abs, name, text });
    } else {
      picks.push({ abs, name, text, loser: `${name} shadowed by ${winner}` });
    }
  }
  return picks;
}

/** `project_doc_fallback_filenames` from <codexHome>/config.toml; none without home. */
function fallbackNames(codexHome: string | undefined): string[] {
  if (!codexHome) return [];
  const toml = readText(path.join(codexHome, 'config.toml'));
  if (toml === undefined) return [];
  // Only top-level keys count: stop at the first [table] header.
  const topLevel = toml.split(/^\s*\[/m)[0] ?? '';
  const match = /^\s*project_doc_fallback_filenames\s*=\s*\[([^\]]*)\]/m.exec(topLevel);
  if (!match) return [];
  const names: string[] = [];
  for (const m of (match[1] ?? '').matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) {
    const name = (m[1] ?? m[2] ?? '').trim();
    if (name) names.push(name);
  }
  return names;
}

function skillDirs(ctx: LoaderContext): string[] {
  const dirs = [path.join(ctx.cwd, '.agents', 'skills')];
  const parent = path.dirname(path.resolve(ctx.cwd));
  if (isInside(ctx.root, parent)) dirs.push(path.join(parent, '.agents', 'skills'));
  dirs.push(path.join(ctx.root, '.agents', 'skills'));
  if (ctx.home) {
    dirs.push(path.join(ctx.home, '.agents', 'skills'));
    // Admin-level skills; part of the machine setup, so only with the user's files.
    if (process.platform !== 'win32') dirs.push('/etc/codex/skills');
  }
  return dirs;
}

function unique(names: string[]): string[] {
  return [...new Set(names)];
}
