import path from 'node:path';
import {
  ancestors,
  compareCodePoints,
  displayPath,
  fileExists,
  readText,
  walkFiles,
} from '../core/fs.ts';
import { expandImports } from '../core/imports.ts';
import { type FoundSkill, makeItem, readSkillsDir, warn } from '../core/items.ts';
import type { Load, Loader, LoaderContext, LoaderItem, Warning } from '../core/types.ts';
import { profiles } from '../profiles.ts';

// Gemini CLI context loading.
// Context files and @imports: https://geminicli.com/docs/cli/gemini-md/ (profiles.gemini.sources[0]).
// Skills: https://geminicli.com/docs/cli/skills/ (profiles.gemini.sources[1]).

const AGENT = 'gemini';
const profile = profiles.gemini;

interface TopFile {
  abs: string;
  text: string;
  load: Load;
  reason: string;
}

export const load: Loader = async (ctx) => {
  const items: LoaderItem[] = [];
  const warnings: Warning[] = [];
  const names = contextFileNames(ctx, warnings);

  // Collect every top-level context file first, so the shared `seen` set stops an @import
  // from counting a file that already loads on its own.
  const top: TopFile[] = [];
  const taken = new Set<string>();
  const add = (abs: string, loadAs: Load, reason: string): void => {
    const resolved = path.resolve(abs);
    if (taken.has(resolved)) return;
    const text = readText(resolved);
    if (text === undefined) return;
    taken.add(resolved);
    top.push({ abs: resolved, text, load: loadAs, reason });
  };

  // Global: ~/.gemini/<name>, read only with --include-user.
  if (ctx.home) {
    const dir = path.join(ctx.home, '.gemini');
    for (const name of names)
      if (fileExists(dir, name)) add(path.join(dir, name), 'startup', 'global context file');
  }

  // Workspace and ancestors, outermost first. Gemini stops the upward walk at the project
  // (.git) root, so even with --include-user nothing above the repo is read; only the global
  // ~/.gemini file above comes from home.
  const cwd = path.resolve(ctx.cwd);
  for (const dir of ancestors(cwd, ctx.root).reverse()) {
    const where = dir === cwd ? 'workspace' : 'ancestor';
    for (const name of names) {
      if (fileExists(dir, name)) add(path.join(dir, name), 'startup', `${name} in ${where}`);
    }
  }

  // Subdirectories below cwd load just-in-time when a tool touches them.
  const nameSet = new Set(names);
  for (const abs of walkFiles(cwd)) {
    const dir = path.dirname(abs);
    if (dir === cwd || !nameSet.has(path.basename(abs))) continue;
    add(abs, 'on-demand', `loaded just-in-time when a tool touches ${displayPath(dir, ctx)}`);
  }

  // @imports, at most profiles.gemini.importMaxDepth hops; imported files follow their importer.
  const seen = new Set(taken);
  let order = 0;
  for (const file of top) {
    items.push(
      makeItem(ctx, AGENT, file.abs, file.text, {
        category: 'instructions',
        load: file.load,
        reason: file.reason,
        order: order++,
      }),
    );
    const result = expandImports(file.abs, file.text, {
      maxDepth: profile.importMaxDepth,
      ...(ctx.home ? { home: ctx.home } : {}),
      // Without --include-user, keep output independent of files outside the repo.
      boundary: ctx.home ? undefined : ctx.root,
      seen,
    });
    for (const imported of result.files) {
      items.push(
        makeItem(ctx, AGENT, imported.abs, imported.text, {
          category: 'instructions',
          load: file.load,
          reason: `imported by ${displayPath(imported.importedFrom, ctx)}`,
          order: order++,
          importedFrom: imported.importedFrom,
        }),
      );
    }
    for (const deep of result.tooDeep) {
      warnings.push(
        warn(
          ctx,
          AGENT,
          deep.importedFrom,
          `import too deep (max ${profile.importMaxDepth}): ${displayPath(deep.abs, ctx)}`,
        ),
      );
    }
    for (const w of result.warnings) warnings.push(warn(ctx, AGENT, w.abs, w.message));
  }

  // Skills, lowest precedence first: user, then workspace; within a tier .agents/skills
  // beats .gemini/skills. Only the winner per name is listed at startup.
  const skillDirs: string[] = [];
  if (ctx.home)
    skillDirs.push(
      path.join(ctx.home, '.gemini', 'skills'),
      path.join(ctx.home, '.agents', 'skills'),
    );
  skillDirs.push(
    path.join(ctx.root, '.gemini', 'skills'),
    path.join(ctx.root, '.agents', 'skills'),
  );
  const found: { skill: FoundSkill; rank: number }[] = [];
  const doneDirs = new Set<string>();
  for (const dir of skillDirs) {
    const resolved = path.resolve(dir);
    if (doneDirs.has(resolved)) continue;
    doneDirs.add(resolved);
    const result = readSkillsDir(ctx, AGENT, resolved);
    warnings.push(...result.warnings);
    for (const skill of result.skills) found.push({ skill, rank: found.length });
  }
  const winner = new Map<string, FoundSkill>();
  for (const { skill } of found) winner.set(skill.name, skill);
  found.sort((a, b) => compareCodePoints(a.skill.name, b.skill.name) || a.rank - b.rank);
  for (const { skill } of found) {
    const best = winner.get(skill.name);
    const wins = best === skill;
    items.push(
      makeItem(ctx, AGENT, skill.abs, `- ${skill.name}: ${skill.description}\n`, {
        category: 'skills',
        load: wins ? 'startup' : 'ignored',
        reason:
          wins || best === undefined
            ? 'skill name and description injected at startup'
            : `overridden by ${displayPath(best.abs, ctx)}`,
        order: order++,
        skill: { name: skill.name, description: skill.description, bodyAbs: skill.abs },
      }),
    );
  }

  return { items, warnings };
};

/**
 * File names from `context.fileName` in settings.json (project overrides user),
 * else profiles.gemini.defaultFileNames.
 */
function contextFileNames(ctx: LoaderContext, warnings: Warning[]): string[] {
  const project = settingsFileName(ctx, path.join(ctx.root, '.gemini', 'settings.json'), warnings);
  if (project) return project;
  if (ctx.home) {
    const user = settingsFileName(ctx, path.join(ctx.home, '.gemini', 'settings.json'), warnings);
    if (user) return user;
  }
  return [...profile.defaultFileNames];
}

function settingsFileName(
  ctx: LoaderContext,
  file: string,
  warnings: Warning[],
): string[] | undefined {
  const text = readText(file);
  if (text === undefined) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    warnings.push(
      warn(
        ctx,
        AGENT,
        file,
        `invalid settings JSON, using default context file names: ${(err as Error).message}`,
      ),
    );
    return undefined;
  }
  const context = isRecord(data) ? data.context : undefined;
  const value = isRecord(context) ? context.fileName : undefined;
  if (value === undefined) return undefined;
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list) || !list.every((n): n is string => typeof n === 'string' && n !== '')) {
    warnings.push(
      warn(ctx, AGENT, file, 'context.fileName must be a string or an array of strings'),
    );
    return undefined;
  }
  return list.length > 0 ? [...new Set(list)] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
