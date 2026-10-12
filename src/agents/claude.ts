import path from 'node:path';
import { boolField, parseFrontmatter, stringField } from '../core/frontmatter.ts';
import {
  ancestors,
  displayPath,
  fileExists,
  isInside,
  readText,
  toPosixRel,
  walkFiles,
} from '../core/fs.ts';
import { expandImports } from '../core/imports.ts';
import { makeItem, readSkillsDir, skillEntry, warn } from '../core/items.ts';
import type {
  Category,
  Load,
  LoaderContext,
  LoaderItem,
  LoaderResult,
  Warning,
} from '../core/types.ts';
import { profiles } from '../profiles.ts';

// Claude Code: what loads at startup, from https://code.claude.com/docs/en/memory.md and
// https://code.claude.com/docs/en/skills.md (profiles.claude.sources).
// Limits (skill budget, description cap) are applied by the simulator, not here.
// Auto memory (MEMORY.md) is skipped in v0.1: its location depends on Claude Code internals.

const AGENT = 'claude';

/** A file read from disk that will become one item (plus its imports). */
interface Candidate {
  abs: string;
  text: string;
  category: Category;
  load: Load;
  reason: string;
}

export const load = async (ctx: LoaderContext): Promise<LoaderResult> => {
  const items: LoaderItem[] = [];
  const warnings: Warning[] = [];
  let order = 0;

  // Without --include-user the walk stops at the repo root (reproducible output).
  // Outermost ancestor first, cwd last: that is the order Claude Code concatenates them.
  const dirs = ancestors(ctx.cwd, ctx.home ? undefined : ctx.root).reverse();
  const userClaude = ctx.home ? path.join(ctx.home, '.claude') : undefined;

  const read = (abs: string): string | undefined => readText(abs);
  const candidate = (
    abs: string,
    category: Category,
    load: Load,
    reason: string,
  ): Candidate | undefined => {
    const text = read(abs);
    return text === undefined ? undefined : { abs, text, category, load, reason };
  };
  // With --include-user the walk can pass through home, so ~/.claude files may come up twice.
  const collected = new Set<string>();
  const add = (list: Candidate[], c: Candidate | undefined): void => {
    if (!c || collected.has(path.resolve(c.abs))) return;
    collected.add(path.resolve(c.abs));
    list.push(c);
  };

  // --- Collect startup instruction files and rules -------------------------------------
  const startup: Candidate[] = [];
  const onDemand: Candidate[] = [];
  const agentsFiles: { abs: string; dir: string }[] = [];
  let hasClaudeFile = false;

  const cwd = path.resolve(ctx.cwd);
  const root = path.resolve(ctx.root);
  // Reason wording is shared across agents: "<name> in repo root|cwd|<dir>".
  const relDir = (dir: string): string =>
    ctx.home && path.resolve(ctx.home) === dir ? '~' : displayPath(dir, ctx);
  const where = (dir: string): string =>
    dir === root ? 'in repo root' : dir === cwd ? 'in cwd' : `in ${relDir(dir)}`;

  /** startupReason gets the rule's POSIX path relative to the rules dir. */
  const collectRules = (rulesDir: string, startupReason: (rel: string) => string): void => {
    // The rules dir supports symlinked folders (shared rule sets), so follow them here only.
    for (const abs of walkFiles(rulesDir, { followSymlinks: true })) {
      if (path.extname(abs) !== '.md') continue;
      if (collected.has(path.resolve(abs))) continue;
      const text = read(abs);
      if (text === undefined) continue;
      const fm = parseFrontmatter(text);
      if (fm.error) warnings.push(warn(ctx, AGENT, abs, fm.error));
      const globs = stringField(fm.data, 'paths')?.trim();
      // The text is the whole file, frontmatter included: that is what gets injected,
      // and keeping it whole keeps the estimate simple and slightly conservative.
      if (globs)
        add(onDemand, {
          abs,
          text,
          category: 'rules',
          load: 'on-demand',
          reason: `on demand: paths ${globs}`,
        });
      else
        add(startup, {
          abs,
          text,
          category: 'rules',
          load: 'startup',
          reason: startupReason(toPosixRel(rulesDir, abs)),
        });
    }
  };

  if (userClaude) {
    if (fileExists(userClaude, 'CLAUDE.md')) {
      add(
        startup,
        candidate(
          path.join(userClaude, 'CLAUDE.md'),
          'instructions',
          'startup',
          'user CLAUDE.md (~/.claude)',
        ),
      );
    }
    collectRules(path.join(userClaude, 'rules'), (rel) => `user rules/${rel} (~/.claude)`);
  }

  for (const dir of dirs) {
    const dotClaude = path.join(dir, '.claude');
    const files: [string, string][] = [
      [dir, 'CLAUDE.md'],
      [dotClaude, 'CLAUDE.md'],
      [dir, 'CLAUDE.local.md'],
    ];
    for (const [d, name] of files) {
      if (!fileExists(d, name)) continue;
      hasClaudeFile = true;
      const abs = path.join(d, name);
      add(
        startup,
        candidate(abs, 'instructions', 'startup', `${toPosixRel(dir, abs)} ${where(dir)}`),
      );
    }
    for (const d of [dir, dotClaude]) {
      if (fileExists(d, 'AGENTS.md')) agentsFiles.push({ abs: path.join(d, 'AGENTS.md'), dir });
    }
    collectRules(path.join(dotClaude, 'rules'), (rel) => `.claude/rules/${rel} ${where(dir)}`);
  }

  // AGENTS.md is a fallback: used only when no CLAUDE-family file exists in cwd or above
  // (the user-level ~/.claude/CLAUDE.md does not count).
  if (!hasClaudeFile) {
    for (const { abs, dir } of agentsFiles) {
      add(
        startup,
        candidate(abs, 'instructions', 'startup', `${toPosixRel(dir, abs)} ${where(dir)}`),
      );
    }
  }

  // Subdirectory CLAUDE.md / CLAUDE.local.md files load lazily, when Claude reads files
  // there. With AGENTS.md as the fallback, a subdirectory AGENTS.md does too, unless that
  // directory has a CLAUDE-family file of its own.
  const hasClaudeIn = (dir: string): boolean =>
    fileExists(dir, 'CLAUDE.md') ||
    fileExists(path.join(dir, '.claude'), 'CLAUDE.md') ||
    fileExists(dir, 'CLAUDE.local.md');
  for (const abs of walkFiles(cwd)) {
    const name = path.basename(abs);
    const parent = path.dirname(abs);
    const inDotClaude = path.basename(parent) === '.claude';
    const owner = inDotClaude ? path.dirname(parent) : parent;
    if (owner === cwd) continue;
    const wanted =
      name === 'CLAUDE.md' ||
      (name === 'CLAUDE.local.md' && !inDotClaude) ||
      (name === 'AGENTS.md' && !hasClaudeFile && !hasClaudeIn(owner));
    if (!wanted) continue;
    add(
      onDemand,
      candidate(
        abs,
        'instructions',
        'on-demand',
        `on demand: loads when working in ${relDir(owner)}`,
      ),
    );
  }

  // --- Emit, expanding @imports with one shared `seen` set ------------------------------
  // Pre-seed with every startup file so a file that is both imported and loaded on its
  // own is counted once (as itself).
  const seen = new Set<string>(startup.map((c) => path.resolve(c.abs)));
  const maxDepth = profiles.claude.importMaxDepth;

  const emit = (c: Candidate): void => {
    items.push(
      makeItem(ctx, AGENT, c.abs, c.text, {
        category: c.category,
        load: c.load,
        reason: c.reason,
        order: order++,
      }),
    );
    if (c.load === 'ignored') return;
    const result = expandImports(c.abs, c.text, {
      maxDepth,
      // Without --include-user, imports outside the repo are skipped (reproducible output).
      ...(ctx.home ? { home: ctx.home } : { boundary: ctx.root }),
      seen,
    });
    for (const f of result.files) {
      items.push(
        makeItem(ctx, AGENT, f.abs, f.text, {
          category: c.category,
          load: c.load,
          reason: `imported by ${displayPath(f.importedFrom, ctx)}`,
          order: order++,
          importedFrom: f.importedFrom,
        }),
      );
    }
    for (const w of result.warnings) warnings.push(warn(ctx, AGENT, w.abs, w.message));
    // The simulator owns drops; loaders only report what they saw.
    for (const t of result.tooDeep) {
      warnings.push(
        warn(
          ctx,
          AGENT,
          t.importedFrom,
          `import too deep (max ${maxDepth}): ${displayPath(t.abs, ctx)}`,
        ),
      );
    }
  };

  for (const c of startup) emit(c);

  // Skills: one listing entry each. User skills first, then project from root down to cwd.
  const skillDirs: string[] = [];
  if (userClaude) skillDirs.push(path.join(userClaude, 'skills'));
  for (const dir of dirs) {
    if (isInside(ctx.root, dir)) skillDirs.push(path.join(dir, '.claude', 'skills'));
  }
  const seenSkills = new Set<string>();
  // Same name: personal beats project, and within the project the first found wins.
  // skillDirs is already in that order, so the first skill with a name keeps it.
  const skillOwner = new Map<string, string>();
  for (const dir of skillDirs) {
    const found = readSkillsDir(ctx, AGENT, dir);
    warnings.push(...found.warnings);
    for (const s of found.skills) {
      const key = path.resolve(s.abs);
      if (seenSkills.has(key)) continue;
      seenSkills.add(key);
      // Claude Code lists description and when_to_use together.
      const text = skillEntry(s.name, [s.description, s.whenToUse].filter(Boolean).join(' '));
      const winner = skillOwner.get(s.name);
      if (winner === undefined) skillOwner.set(s.name, s.abs);
      // A skill only the user can invoke is left out of the listing entirely.
      const disabled = boolField(
        parseFrontmatter(read(s.abs) ?? '').data,
        'disable-model-invocation',
      );
      const reason =
        winner !== undefined
          ? `ignored: overridden by ${displayPath(winner, ctx)}`
          : disabled
            ? 'ignored: disable-model-invocation'
            : 'skill listing entry';
      items.push(
        makeItem(ctx, AGENT, s.abs, text, {
          category: 'skills',
          load: reason.startsWith('ignored') ? 'ignored' : 'startup',
          reason,
          order: order++,
          skill: {
            name: s.name,
            description: s.description,
            ...(s.whenToUse ? { whenToUse: s.whenToUse } : {}),
            bodyAbs: s.abs,
          },
        }),
      );
    }
  }

  // On-demand files (and their imports) unless a startup file already pulled them in.
  for (const c of onDemand) {
    const key = path.resolve(c.abs);
    if (seen.has(key)) continue;
    seen.add(key);
    emit(c);
  }

  // AGENTS.md next to CLAUDE files is never read, unless something imported it.
  if (hasClaudeFile) {
    for (const { abs } of agentsFiles) {
      if (seen.has(path.resolve(abs))) continue;
      const c = candidate(abs, 'instructions', 'ignored', 'ignored: CLAUDE.md present');
      if (c) emit(c);
    }
  }

  return { items, warnings };
};
