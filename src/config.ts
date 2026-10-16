import path from 'node:path';
import { fileExists, readText } from './core/fs.ts';
import type { Tokenizer } from './core/tokenize.ts';
import type { RuleSpec, Source, SpecLimits, ToolSpec } from './core/types.ts';
import type { UserModel } from './models.ts';

// Reads `ctxsize.json` (or the "ctxsize" key of package.json) at the repo root.
// Validation is deliberate and strict: a typo in a key should fail loudly, not silently
// change what is measured.

export class ConfigError extends Error {}

/** A tool from the config file. Fields left out inherit from a built-in tool of the same id. */
export type UserTool = Partial<ToolSpec> & {
  model?: string;
  /** Startup tokens this tool may load before ctxsize exits 1, like --max-tokens for one tool. */
  maxTokens?: number;
};

export interface Config {
  /** Where the config came from, for error messages. */
  origin: string;
  tools: Record<string, UserTool>;
  /** Model definitions; an id that matches a preset overrides fields of that preset. */
  models: Record<string, UserModel>;
  /** Messages for the overhead calculation (default 50). */
  messages?: number;
  /** Globs of files to leave out of every scan (see --exclude). */
  exclude?: string[];
}

export const TOP_KEYS = ['$schema', 'tools', 'models', 'messages', 'exclude'];
export const MODEL_KEYS = ['label', 'contextTokens', 'tokenizer'];
export const TOOL_KEYS = [
  'model',
  'maxTokens',
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
export const RULE_KEYS = ['dir', 'glob', 'load', 'modeKey', 'startupModes', 'conditionalKey'];
export const LIMIT_KEYS = [
  'maxFileBytes',
  'maxTotalBytes',
  'maxFileChars',
  'skillListingMaxBytes',
  'skillDescriptionMaxChars',
  'recommendedMaxLines',
];
const TOOL_ID = /^[a-z][a-z0-9-]{0,39}$/;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,59}$/;

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
    throw new ConfigError(`${origin}: invalid JSON: ${jsonErrorWhere(err as Error, text)}`);
  }
}

export function parseConfig(raw: unknown, origin: string): Config {
  const at = (p: string) => `${origin}: ${p}`;
  if (!isObject(raw)) throw new ConfigError(at(`expected an object, got ${got(raw)}`));
  rejectUnknown(raw, TOP_KEYS, origin);
  const tools: Record<string, UserTool> = {};
  if (raw.tools !== undefined) {
    if (!isObject(raw.tools))
      throw new ConfigError(at(`"tools" must be an object, got ${got(raw.tools)}`));
    for (const [id, value] of Object.entries(raw.tools)) {
      if (!TOOL_ID.test(id)) {
        throw new ConfigError(at(`tool id "${id}" must be lowercase letters, digits and dashes`));
      }
      tools[id] = parseTool(value, `${origin}: tools.${id}`);
    }
  }
  const models: Record<string, UserModel> = {};
  if (raw.models !== undefined) {
    if (!isObject(raw.models))
      throw new ConfigError(at(`"models" must be an object, got ${got(raw.models)}`));
    for (const [id, value] of Object.entries(raw.models)) {
      if (!MODEL_ID.test(id)) {
        throw new ConfigError(
          at(`model id "${id}" must be lowercase letters, digits, dashes, dots or underscores`),
        );
      }
      models[id] = parseModel(value, `${origin}: models.${id}`);
    }
  }
  const config: Config = { origin, tools, models };
  if (raw.$schema !== undefined) str(raw.$schema, at('$schema'));
  if (raw.messages !== undefined) config.messages = posInt(raw.messages, at('messages'));
  if (raw.exclude !== undefined) config.exclude = relPatterns(raw.exclude, at('exclude'));
  return config;
}

function parseModel(value: unknown, where: string): UserModel {
  if (!isObject(value)) throw new ConfigError(`${where}: expected an object, got ${got(value)}`);
  if (value.pricePer1MInput !== undefined) {
    throw new ConfigError(
      `${where}.pricePer1MInput: ctxsize has no prices of its own any more; give yours on the command line, for example --price 3 --per 1m`,
    );
  }
  rejectUnknown(value, MODEL_KEYS, where);
  const model: UserModel = {};
  if (value.label !== undefined) model.label = str(value.label, `${where}.label`);
  if (value.contextTokens !== undefined) {
    model.contextTokens = posInt(value.contextTokens, `${where}.contextTokens`);
  }
  if (value.tokenizer !== undefined) model.tokenizer = parseTokenizer(value.tokenizer, where);
  return model;
}

function parseTokenizer(value: unknown, where: string): Tokenizer {
  if (value === 'o200k_base' || value === 'cl100k_base') return value;
  if (isObject(value)) {
    rejectUnknown(value, ['charsPerToken'], `${where}.tokenizer`);
    const r = value.charsPerToken;
    if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0 || r > 20) {
      throw new ConfigError(
        `${where}.tokenizer.charsPerToken: expected a number between 0 and 20, got ${got(r)}`,
      );
    }
    return { charsPerToken: r };
  }
  throw new ConfigError(
    `${where}.tokenizer: expected "o200k_base", "cl100k_base" or { "charsPerToken": 3.5 }, got ${got(value)}`,
  );
}

function parseTool(value: unknown, where: string): UserTool {
  if (!isObject(value)) throw new ConfigError(`${where}: expected an object, got ${got(value)}`);
  rejectUnknown(value, TOOL_KEYS, where);
  const tool: UserTool = {};
  if (value.model !== undefined) tool.model = str(value.model, `${where}.model`);
  if (value.maxTokens !== undefined) tool.maxTokens = posInt(value.maxTokens, `${where}.maxTokens`);
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
      throw new ConfigError(
        `${where}.firstMatchOnly: expected true or false, got ${got(value.firstMatchOnly)}`,
      );
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
    if (!Array.isArray(value.rules))
      throw new ConfigError(`${where}.rules: expected a list, got ${got(value.rules)}`);
    tool.rules = value.rules.map((r, i) => parseRule(r, `${where}.rules[${i}]`));
  }
  if (value.skills !== undefined) {
    if (!isObject(value.skills))
      throw new ConfigError(`${where}.skills: expected an object, got ${got(value.skills)}`);
    rejectUnknown(value.skills, ['dirs'], `${where}.skills`);
    tool.skills = { dirs: relPatterns(value.skills.dirs, `${where}.skills.dirs`) };
  }
  if (value.limits !== undefined) tool.limits = parseLimits(value.limits, `${where}.limits`);
  if (value.sources !== undefined) tool.sources = parseSources(value.sources, `${where}.sources`);
  if (value.notes !== undefined) {
    if (!Array.isArray(value.notes))
      throw new ConfigError(`${where}.notes: expected a list, got ${got(value.notes)}`);
    tool.notes = value.notes.map((n, i) => str(n, `${where}.notes[${i}]`));
  }
  return tool;
}

function parseRule(value: unknown, where: string): RuleSpec {
  if (!isObject(value)) throw new ConfigError(`${where}: expected an object, got ${got(value)}`);
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
      throw new ConfigError(
        `${where}.startupModes: expected a list, got ${got(value.startupModes)}`,
      );
    }
    rule.startupModes = value.startupModes.map((m, i) => str(m, `${where}.startupModes[${i}]`));
  }
  return rule;
}

function parseLimits(value: unknown, where: string): SpecLimits {
  if (!isObject(value)) throw new ConfigError(`${where}: expected an object, got ${got(value)}`);
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
  if (!Array.isArray(value)) throw new ConfigError(`${where}: expected a list, got ${got(value)}`);
  return value.map((s, i) => {
    const w = `${where}[${i}]`;
    if (!isObject(s)) throw new ConfigError(`${w}: expected an object, got ${got(s)}`);
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

/** What a value is, for "expected X, got Y": `"100" (a string)`, `1.5 (a number)`, `null`. */
function got(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') return 'an object';
  if (typeof v === 'string')
    return `${JSON.stringify(v.length > 40 ? `${v.slice(0, 37)}...` : v)} (a string)`;
  if (typeof v === 'number') return `${v} (a number)`;
  if (typeof v === 'boolean') return `${v} (a boolean)`;
  return 'nothing';
}

/** " — did you mean "x"?" when a typo is close to one of the allowed names, else "". */
function suggest(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== 'string') return '';
  let best: string | undefined;
  let bestDistance = Math.max(2, Math.floor(value.length / 3)) + 1;
  for (const name of allowed) {
    const d = editDistance(value.toLowerCase(), name.toLowerCase());
    if (d < bestDistance) {
      best = name;
      bestDistance = d;
    }
  }
  return best === undefined ? '' : ` (did you mean "${best}"?)`;
}

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length] ?? 0;
}

/** The JSON.parse message plus "line X, column Y" when the runtime gave only a position. */
function jsonErrorWhere(err: Error, text: string): string {
  const m = /position (\d+)/.exec(err.message);
  if (!m || /line \d+/.test(err.message)) return err.message;
  const before = text.slice(0, Number(m[1]));
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  return `${err.message} (line ${line}, column ${column})`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rejectUnknown(obj: Record<string, unknown>, allowed: string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(
        `${where}: unknown key "${key}"${suggest(key, allowed)} (allowed: ${allowed.join(', ')})`,
      );
    }
  }
}

function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || v === '')
    throw new ConfigError(`${where}: expected a non-empty string, got ${got(v)}`);
  return v;
}

function posInt(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new ConfigError(`${where}: expected a positive whole number, got ${got(v)}`);
  }
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], where: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ConfigError(
      `${where}: expected one of ${allowed.join(', ')}${suggest(v, allowed)}, got ${got(v)}`,
    );
  }
  return v as T;
}

/** Relative POSIX patterns only: nothing absolute and no "..", so a config cannot reach outside the repo. */
function relPatterns(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.length === 0)
    throw new ConfigError(`${where}: expected a non-empty list, got ${got(v)}`);
  return v.map((p, i) => {
    const s = str(p, `${where}[${i}]`);
    if (s.includes('\\')) throw new ConfigError(`${where}[${i}]: use "/" as the separator`);
    if (s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').includes('..')) {
      throw new ConfigError(`${where}[${i}]: must be relative to the repo and not contain ".."`);
    }
    return s;
  });
}
