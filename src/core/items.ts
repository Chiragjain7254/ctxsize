import { readdirSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, stringField } from './frontmatter.ts';
import { compareCodePoints, displayPath, fileExists, isInside, readText } from './fs.ts';
import { byteLength } from './tokenize.ts';
import type {
  AgentId,
  Category,
  Load,
  LoaderContext,
  LoaderItem,
  SkillInfo,
  Warning,
} from './types.ts';

export interface ItemFields {
  category: Category;
  load: Load;
  reason: string;
  order: number;
  /** Absolute path of the importing file; converted to a display path here. */
  importedFrom?: string;
  skill?: Omit<SkillInfo, 'bodyPath'> & { bodyAbs: string };
}

/** Builds a LoaderItem with display paths, scope and bytes filled in consistently. */
export function makeItem(
  ctx: LoaderContext,
  agent: AgentId,
  abs: string,
  text: string,
  fields: ItemFields,
): LoaderItem {
  const { importedFrom, skill, ...rest } = fields;
  const item: LoaderItem = {
    agent,
    path: displayPath(abs, ctx),
    // Anything outside the repo (home, /etc, ancestors above root) is the user's machine setup.
    scope: isInside(ctx.root, abs) ? 'project' : 'user',
    text,
    bytes: byteLength(text),
    ...rest,
  };
  if (importedFrom !== undefined) item.importedFrom = displayPath(importedFrom, ctx);
  if (skill !== undefined) {
    const { bodyAbs, ...info } = skill;
    item.skill = { ...info, bodyPath: displayPath(bodyAbs, ctx) };
  }
  return item;
}

export function warn(ctx: LoaderContext, agent: AgentId, abs: string, message: string): Warning {
  return { agent, path: displayPath(abs, ctx), message };
}

export interface FoundSkill {
  /** Absolute path of SKILL.md. */
  abs: string;
  name: string;
  description: string;
  whenToUse?: string;
}

/**
 * Reads `<dir>/<skill>/SKILL.md` for every skill folder in dir, in code-point order.
 * The name falls back to the folder name.
 */
export function readSkillsDir(
  ctx: LoaderContext,
  agent: AgentId,
  dir: string,
): { skills: FoundSkill[]; warnings: Warning[] } {
  const skills: FoundSkill[] = [];
  const warnings: Warning[] = [];
  let folders: string[];
  try {
    folders = readdirSync(dir).sort(compareCodePoints);
  } catch {
    return { skills, warnings };
  }
  for (const folder of folders) {
    const skillDir = path.join(dir, folder);
    if (!fileExists(skillDir, 'SKILL.md')) continue;
    const abs = path.join(skillDir, 'SKILL.md');
    const text = readText(abs);
    if (text === undefined) continue;
    const fm = parseFrontmatter(text);
    if (fm.error) warnings.push(warn(ctx, agent, abs, fm.error));
    const description = stringField(fm.data, 'description')?.trim() ?? '';
    if (!description) warnings.push(warn(ctx, agent, abs, 'skill has no description'));
    const whenToUse = stringField(fm.data, 'when_to_use')?.trim();
    skills.push({
      abs,
      name: stringField(fm.data, 'name')?.trim() || folder,
      description,
      ...(whenToUse ? { whenToUse } : {}),
    });
  }
  return { skills, warnings };
}
