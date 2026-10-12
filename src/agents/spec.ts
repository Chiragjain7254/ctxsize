import { realpathSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, stringField } from '../core/frontmatter.ts';
import { ancestors, fileExists, isInside, readText, toPosixRel, walkFiles } from '../core/fs.ts';
import { hasGlobChars, matchGlob } from '../core/glob.ts';
import { makeItem, readSkillsDir, skillEntry, warn } from '../core/items.ts';
import type {
  Load,
  Loader,
  LoaderContext,
  LoaderItem,
  RuleSpec,
  ToolId,
  ToolSpec,
  Warning,
} from '../core/types.ts';

// The loader for tools described as data (ToolSpec): the five newer built-in tools and
// anything the user defines in ctxsize.json. It reads only what the spec says; limits
// (maxFileBytes, maxTotalBytes, ...) are applied by the simulator.

export function specLoader(id: ToolId, spec: ToolSpec): Loader {
  return async (ctx) => {
    const items: LoaderItem[] = [];
    const warnings: Warning[] = [];
    let order = 0;
    const seen = new Set<string>();
    const add = (item: LoaderItem, abs: string) => {
      // A folder linked into two places (.claude/skills -> .agents/skills) is one set of files.
      const key = realPath(abs);
      if (seen.has(key)) return;
      seen.add(key);
      items.push(item);
    };

    for (const dir of searchDirs(ctx, spec)) {
      const where = dir === path.resolve(ctx.root) ? 'repo root' : toPosixRel(ctx.root, dir);
      for (const abs of instructionFiles(dir, spec)) {
        const text = readText(abs);
        if (text === undefined || text.trim() === '') continue;
        add(
          makeItem(ctx, id, abs, text, {
            category: 'instructions',
            load: spec.instructionLoad ?? 'startup',
            reason:
              spec.instructionLoad === 'on-demand'
                ? `${path.basename(abs)} in ${where}, only if you pass it in`
                : `${path.basename(abs)} in ${where}`,
            order: order++,
          }),
          abs,
        );
      }
    }

    if (spec.nested !== 'ignore') {
      for (const abs of nestedInstructionFiles(ctx, spec)) {
        const text = readText(abs);
        if (text === undefined || text.trim() === '') continue;
        add(
          makeItem(ctx, id, abs, text, {
            category: 'instructions',
            load: 'on-demand',
            reason: `${path.basename(abs)} in a subfolder, loads when its files are used`,
            order: order++,
          }),
          abs,
        );
      }
    }

    for (const rule of spec.rules ?? []) {
      for (const found of ruleFiles(ctx, rule)) {
        const text = readText(found.abs);
        if (text === undefined) continue;
        const { load, reason } = ruleMode(rule, text, warnings, warn(ctx, id, found.abs, ''));
        add(
          makeItem(ctx, id, found.abs, text, {
            category: 'rules',
            load,
            reason,
            order: order++,
          }),
          found.abs,
        );
      }
    }

    for (const dir of spec.skills?.dirs ?? []) {
      const found = readSkillsDir(ctx, id, path.join(ctx.root, ...dir.split('/')));
      warnings.push(...found.warnings);
      for (const skill of found.skills) {
        add(
          makeItem(ctx, id, skill.abs, skillEntry(skill.name, skill.description), {
            category: 'skills',
            load: 'startup',
            reason: 'skill listing entry',
            order: order++,
            skill: { name: skill.name, description: skill.description, bodyAbs: skill.abs },
          }),
          skill.abs,
        );
      }
    }

    return { items, warnings };
  };
}

/** Directories searched for instruction files, in load order (root first). */
function searchDirs(ctx: LoaderContext, spec: ToolSpec): string[] {
  const root = path.resolve(ctx.root);
  const cwd = path.resolve(ctx.cwd);
  switch (spec.search ?? 'root-to-cwd') {
    case 'cwd':
      return [cwd];
    case 'root':
      return [root];
    case 'nearest':
      return ancestors(cwd, root)
        .filter((dir) => instructionFiles(dir, spec).length > 0)
        .slice(0, 1);
    default:
      return ancestors(cwd, root).reverse();
  }
}

/** Files in one directory that match the spec's instruction patterns. */
function instructionFiles(dir: string, spec: ToolSpec): string[] {
  const found: string[] = [];
  for (const pattern of spec.instructions ?? []) {
    const matches = matchesIn(dir, pattern);
    if (matches.length === 0) continue;
    found.push(...matches);
    if (spec.firstMatchOnly) break;
  }
  return [...new Set(found)];
}

function matchesIn(dir: string, pattern: string): string[] {
  // A plain name is an exact-case check; walking the folder is only needed for globs.
  if (!hasGlobChars(pattern)) {
    const abs = path.join(dir, ...pattern.split('/'));
    return fileExists(path.dirname(abs), path.basename(abs)) ? [abs] : [];
  }
  return walkFiles(dir).filter((abs) => matchGlob(pattern, toPosixRel(dir, abs)));
}

/** Same-named instruction files in folders below cwd. */
function nestedInstructionFiles(ctx: LoaderContext, spec: ToolSpec): string[] {
  const names = (spec.instructions ?? []).filter((p) => !hasGlobChars(p) && !p.includes('/'));
  if (names.length === 0) return [];
  const cwd = path.resolve(ctx.cwd);
  return walkFiles(cwd).filter(
    (abs) => path.dirname(abs) !== cwd && names.includes(path.basename(abs)),
  );
}

function ruleFiles(ctx: LoaderContext, rule: RuleSpec): { abs: string }[] {
  const dir = path.join(ctx.root, ...rule.dir.split('/'));
  const glob = rule.glob ?? '**/*.md';
  return walkFiles(dir)
    .filter((abs) => isInside(dir, abs) && matchGlob(glob, toPosixRel(dir, abs)))
    .map((abs) => ({ abs }));
}

function ruleMode(
  rule: RuleSpec,
  text: string,
  warnings: Warning[],
  at: Warning,
): { load: Load; reason: string } {
  const base: Load = rule.load ?? 'startup';
  if (!rule.modeKey && !rule.conditionalKey) return { load: base, reason: `rule in ${rule.dir}/` };
  const fm = parseFrontmatter(text);
  if (fm.error) warnings.push({ ...at, message: fm.error });
  if (rule.conditionalKey) {
    const cond = fm.data[rule.conditionalKey];
    if (cond !== undefined && cond !== null && cond !== '') {
      return { load: 'on-demand', reason: `${rule.conditionalKey}: ${[cond].flat().join(', ')}` };
    }
    if (!rule.modeKey) return { load: base, reason: `rule in ${rule.dir}/` };
  }
  if (!rule.modeKey) return { load: base, reason: `rule in ${rule.dir}/` };
  const mode = stringField(fm.data, rule.modeKey)?.trim();
  if (mode === undefined)
    return { load: base, reason: `rule in ${rule.dir}/ (no ${rule.modeKey})` };
  const startup = (rule.startupModes ?? []).includes(mode);
  return {
    load: startup ? 'startup' : 'on-demand',
    reason: `${rule.modeKey}: ${mode}`,
  };
}

function realPath(abs: string): string {
  try {
    return realpathSync(abs);
  } catch {
    return path.resolve(abs);
  }
}
