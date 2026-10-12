// Cursor: project rules in .cursor/rules, AGENTS.md, and the legacy .cursorrules.
// Source: https://cursor.com/docs/context/rules (see profiles.cursor).
// User rules live in Cursor's settings UI, not on disk, so they are not modelled.
import path from 'node:path';
import { boolField, parseFrontmatter, stringField } from '../core/frontmatter.ts';
import { ancestors, displayPath, fileExists, readText, walkFiles } from '../core/fs.ts';
import { makeItem, warn } from '../core/items.ts';
import type { Load, Loader, LoaderContext, LoaderItem, Warning } from '../core/types.ts';

const AGENT = 'cursor';
const DESCRIPTION_PREVIEW_CHARS = 60;

interface RuleMode {
  load: Load;
  reason: string;
}

/** Decides how a .mdc rule loads from its frontmatter. */
function ruleMode(data: Record<string, unknown>): RuleMode {
  if (boolField(data, 'alwaysApply')) return { load: 'startup', reason: 'alwaysApply' };
  const globs = stringField(data, 'globs')?.trim();
  if (globs) return { load: 'on-demand', reason: `on demand: globs ${globs}` };
  const description = stringField(data, 'description')?.trim();
  if (description) {
    // Agent-requested: at startup Cursor really lists only the description, and the body loads
    // when the agent asks for it. v0.1 counts the whole body as on-demand and does not yet
    // count the description listing toward startup (v0.2).
    return {
      load: 'on-demand',
      reason: `on demand: agent-requested (${description.slice(0, DESCRIPTION_PREVIEW_CHARS)})`,
    };
  }
  return { load: 'on-demand', reason: 'on demand: manual (@-mention only)' };
}

/** "AGENTS.md in repo root", "AGENTS.md in cwd" or "AGENTS.md in <dir>" for a startup file. */
function agentsMdReason(ctx: LoaderContext, dir: string): string {
  if (dir === path.resolve(ctx.root)) return 'AGENTS.md in repo root';
  if (dir === path.resolve(ctx.cwd)) return 'AGENTS.md in cwd';
  return `AGENTS.md in ${displayPath(dir, ctx)}`;
}

/**
 * For a file in a `.cursor/rules` folder nested below cwd (not cwd's own), the directory
 * that owns that folder; otherwise undefined.
 */
function nestedRulesOwner(cwd: string, abs: string): string | undefined {
  const parts = path.relative(cwd, abs).split(path.sep);
  for (let i = 1; i < parts.length - 2; i++) {
    if (parts[i] === '.cursor' && parts[i + 1] === 'rules') {
      return path.join(cwd, ...parts.slice(0, i));
    }
  }
  return undefined;
}

export const load: Loader = async (ctx: LoaderContext) => {
  const items: LoaderItem[] = [];
  const warnings: Warning[] = [];
  let order = 0;

  // Root first, then each directory down to cwd.
  const chain = ancestors(ctx.cwd, ctx.root).reverse();

  // AGENTS.md from root down to cwd: always in context.
  for (const dir of chain) {
    if (!fileExists(dir, 'AGENTS.md')) continue;
    const abs = path.join(dir, 'AGENTS.md');
    const text = readText(abs);
    if (text === undefined) continue;
    items.push(
      makeItem(ctx, AGENT, abs, text, {
        category: 'instructions',
        load: 'startup',
        reason: agentsMdReason(ctx, dir),
        order: order++,
      }),
    );
  }

  // Legacy single-file rules at the root. The simulator turns this into a 'legacy' drop.
  if (fileExists(ctx.root, '.cursorrules')) {
    const abs = path.join(ctx.root, '.cursorrules');
    const text = readText(abs);
    if (text !== undefined) {
      items.push(
        makeItem(ctx, AGENT, abs, text, {
          category: 'rules',
          load: 'startup',
          reason: 'legacy .cursorrules (no longer documented)',
          order: order++,
        }),
      );
    }
  }

  const seen = new Set<string>();
  /** Emits one file from a .cursor/rules folder; nestedOwner forces it on-demand. */
  const pushRule = (abs: string, nestedOwner?: string): void => {
    if (seen.has(abs)) return;
    seen.add(abs);
    const text = readText(abs);
    if (text === undefined) return;
    if (path.extname(abs) !== '.mdc') {
      items.push(
        makeItem(ctx, AGENT, abs, text, {
          category: 'rules',
          load: 'ignored',
          reason: 'ignored: only .mdc files are rules',
          order: order++,
        }),
      );
      return;
    }
    const fm = parseFrontmatter(text, { lenient: true });
    if (fm.error) warnings.push(warn(ctx, AGENT, abs, fm.error));
    const mode: RuleMode =
      nestedOwner === undefined
        ? ruleMode(fm.error ? {} : fm.data)
        : {
            load: 'on-demand',
            reason: `on demand: nested rules for ${displayPath(nestedOwner, ctx)}`,
          };
    // Frontmatter is metadata; Cursor injects only the rule body.
    items.push(makeItem(ctx, AGENT, abs, fm.body, { category: 'rules', ...mode, order: order++ }));
  };

  // Project rules: .cursor/rules in root and every directory down to cwd.
  for (const dir of chain) {
    for (const abs of walkFiles(path.join(dir, '.cursor', 'rules'))) pushRule(abs);
  }

  // Nested .cursor/rules below cwd attach only when files in their directory are referenced,
  // so every rule there is on-demand whatever its frontmatter says.
  const cwd = path.resolve(ctx.cwd);
  for (const abs of walkFiles(cwd)) {
    const owner = nestedRulesOwner(cwd, abs);
    if (owner !== undefined) pushRule(abs, owner);
  }

  // AGENTS.md in subdirectories below cwd apply only when working there.
  for (const abs of walkFiles(cwd)) {
    const dir = path.dirname(abs);
    if (dir === cwd || path.basename(abs) !== 'AGENTS.md') continue;
    const text = readText(abs);
    if (text === undefined) continue;
    items.push(
      makeItem(ctx, AGENT, abs, text, {
        category: 'instructions',
        load: 'on-demand',
        reason: `on demand: loads when working in ${displayPath(dir, ctx)}`,
        order: order++,
      }),
    );
  }

  return { items, warnings };
};
