import path from 'node:path';
import { fileExists, readText } from './core/fs.ts';
import type { RuleSpec, Source, SpecLimits, ToolSpec } from './core/types.ts';

// Reads `ctxsize.json` (or the "ctxsize" key of package.json) at the repo root.
// Validation is deliberate and strict: a typo in a key should fail loudly, not silently
// change what is measured.

export class ConfigError extends Error {}

/** A tool from the config file. Fields left out inherit from a built-in tool of the same id. */
export type UserTool = Partial<ToolSpec>;

export interface Config {
  /** Where the config came from, for error messages. */
  origin: string;
  tools: Record<string, UserTool>;
}

const TOP_KEYS = ['tools'];
const TOOL_KEYS = [
  'label',
  'defaultContextTokens',
  'instructions',
  'search',
  'firstMatchOnly',
  'nested',
  'instructionLoad',
  'rules',
  'skills',
  'limits',
  'sources',
  'notes',
];
const RULE_KEYS = ['dir', 'glob', 'load', 'modeKey', 'startupModes', 'conditionalKey'];
const LIMIT_KEYS = [
  'maxFileBytes',
  'maxTotalBytes',
  'maxFileChars',
  'skillListingMaxBytes',
  'skillDescriptionMaxChars',
  'recommendedMaxLines',
];
const TOOL_ID = /^[a-z][a-z0-9-]{0,39}$/;

export function loadConfig(root: string): Config | undefined {
  if (fileExists(root, 'ctxsize.json')) {
    const file = path.join(root, 'ctxsize.json');
    return parseConfig(parseJson(readText(file) ?? '', 'ctxsize.json'), 'ctxsize.json');
  }
  if (fileExists(root, 'package.json')) {
    const pkg = parseJson(readText(path.join(root, 'package.json')) ?? '', 'package.json');
    if (isObject(pkg) && pkg.ctxsize !== undefined) {
      return parseConfig(pkg.ctxsize, 'package.json "ctxsize"');
    }
  }
  return undefined;
}

function parseJson(text: string, origin: string): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    // package.json that does not parse is not ours to complain about unless it is ctxsize.json.
    if (origin === 'package.json') return undefined;
    throw new ConfigError(`${origin}: invalid JSON: ${(err as Error).message}`);
  }
}

export function parseConfig(raw: unknown, origin: string): Config {
  const at = (p: string) => `${origin}: ${p}`;
  if (!isObject(raw)) throw new ConfigError(at('expected an object'));
  rejectUnknown(raw, TOP_KEYS, origin);
  const tools: Record<string, UserTool> = {};
  if (raw.tools !== undefined) {
    if (!isObject(raw.tools)) throw new ConfigError(at('"tools" must be an object'));
    for (const [id, value] of Object.entries(raw.tools)) {
      if (!TOOL_ID.test(id)) {
        throw new ConfigError(at(`tool id "${id}" must be lowercase letters, digits and dashes`));
      }
      tools[id] = parseTool(value, `${origin}: tools.${id}`);
    }
  }
  return { origin, tools };
}

function parseTool(value: unknown, where: string): UserTool {
  if (!isObject(value)) throw new ConfigError(`${where}: expected an object`);
  rejectUnknown(value, TOOL_KEYS, where);
  const tool: UserTool = {};
  if (value.label !== undefined) tool.label = str(value.label, `${where}.label`);
  if (value.defaultContextTokens !== undefined) {
    tool.defaultContextTokens = posInt(value.defaultContextTokens, `${where}.defaultContextTokens`);
  }
  if (value.instructions !== undefined) {
    tool.instructions = relPatterns(value.instructions, `${where}.instructions`);
  }
  if (value.search !== undefined) {
    tool.search = oneOf(
      value.search,
      ['root-to-cwd', 'cwd', 'root', 'nearest'] as const,
      `${where}.search`,
    );
  }
  if (value.firstMatchOnly !== undefined) {
    if (typeof value.firstMatchOnly !== 'boolean') {
      throw new ConfigError(`${where}.firstMatchOnly: expected true or false`);
    }
    tool.firstMatchOnly = value.firstMatchOnly;
  }
  if (value.nested !== undefined) {
    tool.nested = oneOf(value.nested, ['on-demand', 'ignore'] as const, `${where}.nested`);
  }
  if (value.instructionLoad !== undefined) {
    tool.instructionLoad = oneOf(
      value.instructionLoad,
      ['startup', 'on-demand'] as const,
      `${where}.instructionLoad`,
    );
  }
  if (value.rules !== undefined) {
    if (!Array.isArray(value.rules)) throw new ConfigError(`${where}.rules: expected a list`);
    tool.rules = value.rules.map((r, i) => parseRule(r, `${where}.rules[${i}]`));
  }
  if (value.skills !== undefined) {
    if (!isObject(value.skills)) throw new ConfigError(`${where}.skills: expected an object`);
    rejectUnknown(value.skills, ['dirs'], `${where}.skills`);
    tool.skills = { dirs: relPatterns(value.skills.dirs, `${where}.skills.dirs`) };
  }
  if (value.limits !== undefined) tool.limits = parseLimits(value.limits, `${where}.limits`);
  if (value.sources !== undefined) tool.sources = parseSources(value.sources, `${where}.sources`);
  if (value.notes !== undefined) {
    if (!Array.isArray(value.notes)) throw new ConfigError(`${where}.notes: expected a list`);
    tool.notes = value.notes.map((n, i) => str(n, `${where}.notes[${i}]`));
  }
  return tool;
}

function parseRule(value: unknown, where: string): RuleSpec {
  if (!isObject(value)) throw new ConfigError(`${where}: expected an object`);
  rejectUnknown(value, RULE_KEYS, where);
  const [dir] = relPatterns([value.dir], `${where}.dir`);
  const rule: RuleSpec = { dir: (dir ?? '').replace(/\/+$/, '') };
  if (value.glob !== undefined) rule.glob = relPatterns([value.glob], `${where}.glob`)[0] ?? '';
  if (value.load !== undefined) {
    rule.load = oneOf(value.load, ['startup', 'on-demand'] as const, `${where}.load`);
  }
  if (value.modeKey !== undefined) rule.modeKey = str(value.modeKey, `${where}.modeKey`);
  if (value.conditionalKey !== undefined) {
    rule.conditionalKey = str(value.conditionalKey, `${where}.conditionalKey`);
  }
  if (value.startupModes !== undefined) {
    if (!Array.isArray(value.startupModes)) {
      throw new ConfigError(`${where}.startupModes: expected a list`);
    }
    rule.startupModes = value.startupModes.map((m, i) => str(m, `${where}.startupModes[${i}]`));
  }
  return rule;
}

function parseLimits(value: unknown, where: string): SpecLimits {
  if (!isObject(value)) throw new ConfigError(`${where}: expected an object`);
  rejectUnknown(value, LIMIT_KEYS, where);
  const limits: SpecLimits = {};
  for (const key of LIMIT_KEYS) {
    if (value[key] !== undefined) {
      limits[key as keyof SpecLimits] = posInt(value[key], `${where}.${key}`);
    }
  }
  return limits;
}

function parseSources(value: unknown, where: string): Source[] {
  if (!Array.isArray(value)) throw new ConfigError(`${where}: expected a list`);
  return value.map((s, i) => {
    const w = `${where}[${i}]`;
    if (!isObject(s)) throw new ConfigError(`${w}: expected an object`);
    rejectUnknown(s, ['url', 'checked', 'note'], w);
    const url = str(s.url, `${w}.url`);
    if (!url.startsWith('https://')) throw new ConfigError(`${w}.url: must start with https://`);
    const checked = str(s.checked, `${w}.checked`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checked)) {
      throw new ConfigError(`${w}.checked: expected YYYY-MM-DD`);
    }
    return { url, checked, ...(s.note !== undefined ? { note: str(s.note, `${w}.note`) } : {}) };
  });
}

// ---------------------------------------------------------------- helpers

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rejectUnknown(obj: Record<string, unknown>, allowed: string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(`${where}: unknown key "${key}" (allowed: ${allowed.join(', ')})`);
    }
  }
}

function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || v === '')
    throw new ConfigError(`${where}: expected a non-empty string`);
  return v;
}

function posInt(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new ConfigError(`${where}: expected a positive whole number`);
  }
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], where: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ConfigError(`${where}: expected one of ${allowed.join(', ')}`);
  }
  return v as T;
}

/** Relative POSIX patterns only: nothing absolute and no "..", so a config cannot reach outside the repo. */
function relPatterns(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.length === 0)
    throw new ConfigError(`${where}: expected a non-empty list`);
  return v.map((p, i) => {
    const s = str(p, `${where}[${i}]`);
    if (s.includes('\\')) throw new ConfigError(`${where}[${i}]: use "/" as the separator`);
    if (s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').includes('..')) {
      throw new ConfigError(`${where}[${i}]: must be relative to the repo and not contain ".."`);
    }
    return s;
  });
}
