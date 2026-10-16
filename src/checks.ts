import { countTokens } from './core/tokenize.ts';
import type { AgentReport, Check, ToolId } from './core/types.ts';
import { profiles } from './profiles.ts';
import type { Tool } from './tools.ts';

// Smart checks: duplicates, fix suggestions and skill health. Pure functions over the
// report's items (no file system access). Thresholds are deliberately conservative: a check
// that fires on small numbers is noise, and noise teaches people to ignore the section.

/** A paragraph or list item shorter than this (normalised characters) is too generic to call a duplicate. */
const MIN_DUPLICATE_CHARS = 40;
/** Shared paragraphs between a set of files are reported only past this many tokens in total. */
const MIN_DUPLICATE_TOKENS = 30;
/** Two files are "nearly identical" when this share of the smaller one is found in the other. */
const NEAR_IDENTICAL_SHARE = 0.9;

/** A "## section" bigger than this many tokens is worth moving out of the always-loaded file. */
const BIG_SECTION_TOKENS = 800;
/** A startup load past this share of the window is worth trimming for a tool that has no skills. */
const TRIM_STARTUP_SHARE = 0.05;
/** ...but never when the absolute number is small (a tiny --context makes any file look big). */
const TRIM_MIN_STARTUP_TOKENS = 3000;
/** A section with this many numbered steps reads as a procedure even without a telling heading. */
const PROCEDURE_STEPS = 5;
/** ...or this many code blocks reads as a how-to. */
const PROCEDURE_CODE_BLOCKS = 4;

/** A description this close below the cut-off (fraction of the limit) is about to be cut. */
const NEAR_CUTOFF_FROM = 0.9;
/** Descriptions shorter than this many characters tell the agent too little to pick the skill. */
const MIN_DESCRIPTION_CHARS = 20;
/** Skills whose description word sets overlap at least this much (Jaccard) compete for the same prompts. */
const OVERLAP_JACCARD = 0.6;
/** Overlap needs this many distinct words on both sides; two-word descriptions overlap by accident. */
const OVERLAP_MIN_WORDS = 4;

const GENERIC_START =
  /^\s*(a\s+|an\s+|the\s+)?(helper|helpers|utility|utilities|useful|does things|do things|misc|stuff|general)\b/i;
const TRIGGER =
  /\b(use|used|invoke|invoked|trigger|triggers|triggered|activate)\b.{0,40}\b(when|if|whenever|for|on)\b|\bwhen\b/i;
const TASK_HEADING =
  /\b(deploy\w*|release\w*|publish\w*|migrat\w*|runbook|playbook|troubleshoot\w*|debug\w*|incident\w*|onboard\w*|set ?up|how to|workflow|procedure|checklist|cookbook|recipe|tutorial|testing|contribut\w*|pull requests?|benchmark\w*)\b/i;
const STOP_WORDS = new Set(
  `a an and are as at be by for from has have how if in into is it its of on or that the their then this to use used using when whenever with you your will can should also any all not but they them these those there which what who whom than such via per about over after before while each other more most some only same so`.split(
    /\s+/,
  ),
);

const KIND_ORDER = { duplicate: 0, suggestion: 1, 'skill-health': 2 } as const;
const STARTUP_TEXT = new Set(['instructions', 'rules', 'memory']);

/** Per-tool description cut-offs in characters, from the documented limits. */
export function skillDescriptionLimits(tools: readonly Tool[]): Record<ToolId, number> {
  const out: Record<ToolId, number> = {};
  for (const tool of tools) {
    if (tool.id === 'claude') out[tool.id] = profiles.claude.skillListingMaxDescChars;
    else if (tool.spec?.limits?.skillDescriptionMaxChars !== undefined) {
      out[tool.id] = tool.spec.limits.skillDescriptionMaxChars;
    }
  }
  return out;
}

export interface CheckOptions {
  /** Skill description cut-off per tool, in characters. */
  descriptionLimits?: Record<ToolId, number>;
}

export function computeChecks(agents: readonly AgentReport[], opts: CheckOptions = {}): Check[] {
  const checks = [
    ...duplicateChecks(agents),
    ...suggestionChecks(agents),
    ...skillChecks(agents, opts.descriptionLimits ?? {}),
  ];
  return checks.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.severity === b.severity ? 0 : a.severity === 'warn' ? -1 : 1) ||
      cmp(a.code, b.code) ||
      cmp(a.paths.join('\0'), b.paths.join('\0')) ||
      cmp(a.message, b.message),
  );
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const num = (n: number) => n.toLocaleString('en-US');
const unique = <T>(xs: Iterable<T>): T[] => [...new Set(xs)];

/** Lower-case, strip list markers, collapse every run of whitespace (CRLF included). */
export function normalize(text: string): string {
  return text
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ------------------------------------------------------------------ files

interface FileInfo {
  path: string;
  text: string;
  tokens: number;
  tools: Set<ToolId>;
  importedFrom?: string;
}

/** Each loaded startup instruction file once, however many tools read it. */
function startupFiles(agents: readonly AgentReport[]): FileInfo[] {
  const byPath = new Map<string, FileInfo>();
  for (const agent of agents) {
    for (const item of agent.items) {
      if (item.load !== 'startup' || !STARTUP_TEXT.has(item.category)) continue;
      const known = byPath.get(item.path);
      if (known) {
        known.tools.add(agent.agent);
        continue;
      }
      byPath.set(item.path, {
        path: item.path,
        text: item.text,
        tokens: item.tokens,
        tools: new Set([agent.agent]),
        ...(item.importedFrom !== undefined ? { importedFrom: item.importedFrom } : {}),
      });
    }
  }
  return [...byPath.values()].sort((a, b) => cmp(a.path, b.path));
}

/** True when one file is (transitively) imported by the other: they are one document. */
function importRelated(files: Map<string, FileInfo>, a: string, b: string): boolean {
  const reaches = (from: string, target: string): boolean => {
    const seen = new Set<string>();
    let cur = files.get(from)?.importedFrom;
    while (cur !== undefined && !seen.has(cur)) {
      if (cur === target) return true;
      seen.add(cur);
      cur = files.get(cur)?.importedFrom;
    }
    return false;
  };
  return reaches(a, b) || reaches(b, a);
}

/** Keeps the files that are not import-related to an earlier kept one. */
function dropRelated(files: Map<string, FileInfo>, paths: string[]): string[] {
  const kept: string[] = [];
  for (const p of paths) if (!kept.some((k) => importRelated(files, k, p))) kept.push(p);
  return kept;
}

/** Paragraphs and list items of a markdown text, code blocks and headings left out. */
export function blocks(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence: string | undefined;
  const flush = () => {
    if (cur.length > 0) out.push(cur.join(' '));
    cur = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      flush();
      if (fence === undefined) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    if (line.trim() === '' || /^\s{0,3}#{1,6}\s/.test(line)) {
      flush();
    } else if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      cur.push(line);
    } else {
      cur.push(line);
    }
  }
  flush();
  return out.filter((b) => !b.trimStart().startsWith('@'));
}

function list(paths: string[]): string {
  return paths.length === 2
    ? `${paths[0]} and ${paths[1]}`
    : `${paths.slice(0, -1).join(', ')} and ${paths[paths.length - 1]}`;
}

/** The one tool that loads every file in the set, if exactly one does. */
function commonTools(files: Map<string, FileInfo>, paths: string[]): ToolId[] {
  const sets = paths.map((p) => files.get(p)?.tools ?? new Set<ToolId>());
  const first = sets[0] ?? new Set<ToolId>();
  return [...first].filter((t) => sets.every((s) => s.has(t))).sort();
}

function duplicateChecks(agents: readonly AgentReport[]): Check[] {
  const files = startupFiles(agents);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const checks: Check[] = [];
  const make = (
    paths: string[],
    code: string,
    message: (tokens: number) => string,
    tokens: number,
  ): Check => {
    const together = commonTools(byPath, paths);
    return {
      ...(together.length === 1 && together[0] !== undefined ? { tool: together[0] } : {}),
      kind: 'duplicate',
      code,
      // Loaded together by some tool: the tokens are really paid twice. Otherwise it is only upkeep.
      severity: together.length > 0 ? 'warn' : 'info',
      message: message(tokens),
      paths,
      tokens,
    };
  };

  // Whole files with the same content.
  const identicalPairs = new Set<string>();
  const byContent = new Map<string, FileInfo[]>();
  for (const f of files) {
    const key = normalize(f.text.replace(/\s+/g, ' '));
    if (key.length < MIN_DUPLICATE_CHARS) continue;
    byContent.set(key, [...(byContent.get(key) ?? []), f]);
  }
  for (const group of byContent.values()) {
    const paths = dropRelated(
      byPath,
      group.map((f) => f.path),
    );
    if (paths.length < 2) continue;
    for (const a of paths) for (const b of paths) identicalPairs.add(`${a}\0${b}`);
    const tokens = (byPath.get(paths[0] ?? '')?.tokens ?? 0) * (paths.length - 1);
    checks.push(
      make(
        paths,
        'duplicate-file',
        (t) => `${list(paths)} are identical, ${num(t)} tokens duplicated`,
        tokens,
      ),
    );
  }

  // Paragraphs and list items found in several files.
  const where = new Map<string, Set<string>>();
  const chars = new Map<string, number>();
  for (const f of files) {
    let total = 0;
    for (const raw of blocks(f.text)) {
      const key = normalize(raw);
      total += key.length;
      if (key.length < MIN_DUPLICATE_CHARS) continue;
      where.set(key, (where.get(key) ?? new Set()).add(f.path));
    }
    chars.set(f.path, total);
  }
  const shared = new Map<
    string,
    { paths: string[]; tokens: number; chars: number; count: number }
  >();
  const pairChars = new Map<string, number>();
  for (const [key, set] of where) {
    const paths = dropRelated(byPath, [...set].sort(cmp));
    if (paths.length < 2) continue;
    const tokens = countTokens(key) * (paths.length - 1);
    const id = paths.join('\0');
    const entry = shared.get(id) ?? { paths, tokens: 0, chars: 0, count: 0 };
    entry.tokens += tokens;
    entry.chars += key.length;
    entry.count++;
    shared.set(id, entry);
    for (const a of paths)
      for (const b of paths)
        if (a < b) pairChars.set(`${a}\0${b}`, (pairChars.get(`${a}\0${b}`) ?? 0) + key.length);
  }

  // Files that are the same document in all but a few lines: one check, not one per paragraph.
  const nearPairs = new Set<string>();
  for (const [id, shareChars] of [...pairChars].sort((x, y) => cmp(x[0], y[0]))) {
    const [a = '', b = ''] = id.split('\0');
    if (identicalPairs.has(`${a}\0${b}`)) continue;
    const smaller = Math.min(chars.get(a) ?? 0, chars.get(b) ?? 0);
    if (smaller === 0 || shareChars / smaller < NEAR_IDENTICAL_SHARE) continue;
    nearPairs.add(id);
    const tokens = Math.min(byPath.get(a)?.tokens ?? 0, byPath.get(b)?.tokens ?? 0);
    const share = Math.round((shareChars / smaller) * 100);
    checks.push(
      make(
        [a, b],
        'near-identical-files',
        (t) =>
          `${a} and ${b} are nearly identical (${share}% shared), about ${num(t)} tokens duplicated`,
        tokens,
      ),
    );
  }

  for (const s of [...shared.values()].sort((x, y) =>
    cmp(x.paths.join('\0'), y.paths.join('\0')),
  )) {
    const pairs = s.paths.flatMap((a, i) => s.paths.slice(i + 1).map((b) => `${a}\0${b}`));
    if (pairs.every((p) => identicalPairs.has(p) || nearPairs.has(p))) continue;
    if (s.tokens < MIN_DUPLICATE_TOKENS) continue;
    checks.push(
      make(
        s.paths,
        'duplicate-paragraphs',
        (t) =>
          `${list(s.paths)} repeat ${s.count} paragraph${s.count === 1 ? '' : 's'}, ${num(t)} tokens duplicated`,
        s.tokens,
      ),
    );
  }

  checks.push(...duplicateSkills(agents));
  return checks;
}

// ------------------------------------------------------------------ suggestions

interface Section {
  heading: string;
  text: string;
}

/** Level-2 sections ("## heading") outside code blocks. */
export function sections(text: string): Section[] {
  const out: Section[] = [];
  let cur: { heading: string; lines: string[] } | undefined;
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === undefined) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
    }
    const h = fence === undefined && !marker ? /^##\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (h) {
      if (cur) out.push({ heading: cur.heading, text: cur.lines.join('\n') });
      cur = { heading: h[1] ?? '', lines: [line] };
    } else if (fence === undefined && !marker && /^#\s/.test(line)) {
      if (cur) out.push({ heading: cur.heading, text: cur.lines.join('\n') });
      cur = undefined;
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) out.push({ heading: cur.heading, text: cur.lines.join('\n') });
  return out;
}

function looksTaskSpecific(section: Section): boolean {
  if (TASK_HEADING.test(section.heading)) return true;
  const steps = (section.text.match(/^\s*\d+[.)]\s/gm) ?? []).length;
  const fences = (section.text.match(/^\s{0,3}(?:`{3,}|~{3,})/gm) ?? []).length / 2;
  return steps >= PROCEDURE_STEPS || fences >= PROCEDURE_CODE_BLOCKS;
}

function suggestionChecks(agents: readonly AgentReport[]): Check[] {
  const checks: Check[] = [];
  for (const f of startupFiles(agents)) {
    for (const section of sections(f.text)) {
      const tokens = countTokens(section.text);
      if (tokens <= BIG_SECTION_TOKENS || !looksTaskSpecific(section)) continue;
      const tools = [...f.tools].sort();
      checks.push({
        ...(tools.length === 1 && tools[0] !== undefined ? { tool: tools[0] } : {}),
        kind: 'suggestion',
        code: 'move-to-skill',
        severity: 'info',
        message: `move '${section.heading}' (${num(tokens)} tokens) into a skill so it loads on demand`,
        paths: [f.path],
        tokens,
      });
    }
  }

  // Tools without skills cannot load things on demand through them, so a heavy startup is all there is to trim.
  for (const agent of agents) {
    if (agent.items.some((i) => i.category === 'skills')) continue;
    const { total } = agent.startup;
    // An unknown window cannot be compared with, so nothing is suggested.
    if (agent.contextTokens === null) continue;
    if (total < TRIM_MIN_STARTUP_TOKENS || total <= agent.contextTokens * TRIM_STARTUP_SHARE)
      continue;
    const biggest = agent.topFiles[0];
    checks.push({
      tool: agent.agent,
      kind: 'suggestion',
      code: 'trim-startup',
      severity: 'info',
      message: `${agent.label} loads ${num(total)} tokens at startup (${Math.round((total / agent.contextTokens) * 100)}% of its window) and has no skills; trim${biggest ? ` ${biggest.path} (${num(biggest.tokens)} tokens) or` : ''} move task-specific parts to rules that load on demand`,
      paths: biggest ? [biggest.path] : [],
      tokens: total,
    });
  }
  return checks;
}

// ------------------------------------------------------------------ skills

interface SkillRow {
  key: string;
  name: string;
  description: string;
  hasTrigger: boolean;
  path: string;
  tools: Set<ToolId>;
  tokens: number;
}

function uniqueSkills(agents: readonly AgentReport[]): SkillRow[] {
  const rows = new Map<string, SkillRow>();
  for (const agent of agents) {
    for (const item of agent.items) {
      const skill = item.skill;
      if (!skill || item.load === 'ignored') continue;
      const known = rows.get(skill.bodyPath);
      if (known) {
        known.tools.add(agent.agent);
        continue;
      }
      rows.set(skill.bodyPath, {
        key: skill.bodyPath,
        name: skill.name,
        description: [skill.description, skill.whenToUse].filter(Boolean).join(' ').trim(),
        hasTrigger: skill.whenToUse !== undefined || TRIGGER.test(skill.description),
        path: skill.bodyPath,
        tools: new Set([agent.agent]),
        tokens: item.tokens,
      });
    }
  }
  return [...rows.values()].sort((a, b) => cmp(a.path, b.path));
}

function one(tools: Iterable<ToolId>): { tool?: ToolId } {
  const all = [...tools];
  return all.length === 1 && all[0] !== undefined ? { tool: all[0] } : {};
}

function duplicateSkills(agents: readonly AgentReport[]): Check[] {
  const groups = new Map<string, SkillRow[]>();
  for (const s of uniqueSkills(agents)) {
    if (s.description === '') continue;
    const key = `${s.name.toLowerCase()}\0${normalize(s.description)}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const out: Check[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const paths = group.map((s) => s.path);
    const tools = group.flatMap((s) => [...s.tools]);
    const tokens = (group[0]?.tokens ?? 0) * (group.length - 1);
    out.push({
      ...one(unique(tools)),
      kind: 'duplicate',
      code: 'duplicate-skill',
      severity: 'warn',
      message: `skill ${group[0]?.name} is defined twice with the same description (${list(paths)}), ${num(tokens)} tokens duplicated`,
      paths,
      tokens,
    });
  }
  return out;
}

function words(description: string): Set<string> {
  return new Set(
    (description.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? []).filter(
      (w) => w.length >= 3 && !STOP_WORDS.has(w),
    ),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

function skillChecks(agents: readonly AgentReport[], limits: Record<ToolId, number>): Check[] {
  const skills = uniqueSkills(agents);
  const checks: Check[] = [];
  const health = (
    s: SkillRow,
    code: string,
    severity: Check['severity'],
    message: string,
  ): void => {
    checks.push({
      ...one(s.tools),
      kind: 'skill-health',
      code,
      severity,
      message: `skill ${s.name}: ${message}`,
      paths: [s.path],
    });
  };

  for (const s of skills) {
    const len = [...s.description].length;
    if (len === 0) {
      health(
        s,
        'skill-no-description',
        'warn',
        'has no description, so the agent cannot tell when to use it',
      );
      continue;
    }
    const caps = [...s.tools].map((t) => limits[t]).filter((l): l is number => l !== undefined);
    const cap = caps.length > 0 ? Math.min(...caps) : undefined;
    if (cap !== undefined && len <= cap && len >= cap * NEAR_CUTOFF_FROM) {
      health(
        s,
        'skill-near-cutoff',
        'warn',
        `description is ${num(len)} of ${num(cap)} characters, close to where it is cut`,
      );
    }
    if (len < MIN_DESCRIPTION_CHARS || GENERIC_START.test(s.description)) {
      health(s, 'skill-vague', 'warn', 'description is vague; say what it does and when to use it');
    } else if (!s.hasTrigger) {
      health(s, 'skill-no-trigger', 'info', "description has no 'Use when ...' trigger");
    }
  }

  const sets = skills.map((s) => words(s.description));
  const seen = new Set<string>();
  for (const [i, a] of skills.entries()) {
    for (const [j, b] of skills.entries()) {
      if (j <= i) continue;
      const wa = sets[i];
      const wb = sets[j];
      if (!wa || !wb || wa.size < OVERLAP_MIN_WORDS || wb.size < OVERLAP_MIN_WORDS) continue;
      if (![...a.tools].some((t) => b.tools.has(t))) continue;
      // The same name and text is a duplicate, reported elsewhere.
      if (
        a.name.toLowerCase() === b.name.toLowerCase() &&
        normalize(a.description) === normalize(b.description)
      )
        continue;
      const score = jaccard(wa, wb);
      if (score < OVERLAP_JACCARD) continue;
      const id = `${a.path}\0${b.path}`;
      if (seen.has(id)) continue;
      seen.add(id);
      checks.push({
        ...one(unique([...a.tools, ...b.tools].filter((t) => a.tools.has(t) && b.tools.has(t)))),
        kind: 'skill-health',
        code: 'skill-overlap',
        severity: 'warn',
        message: `skills ${a.name} and ${b.name} have overlapping descriptions (${Math.round(score * 100)}% of words shared); the agent may pick the wrong one`,
        paths: [a.path, b.path],
      });
    }
  }
  return checks;
}
