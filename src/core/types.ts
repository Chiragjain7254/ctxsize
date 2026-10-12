// The contract every loader, the simulator and every report share. Frozen after M1:
// loaders are built in parallel against it, so changes here need a coordinated commit.

/** The five tools with a hand-written loader. */
export type AgentId = 'claude' | 'codex' | 'cursor' | 'copilot' | 'gemini';
export const AGENT_IDS: readonly AgentId[] = ['claude', 'codex', 'cursor', 'copilot', 'gemini'];

/** Any tool: a built-in id or one defined in ctxsize.json. */
export type ToolId = string;

export type Category = 'instructions' | 'rules' | 'skills' | 'memory';
export const CATEGORIES: readonly Category[] = ['instructions', 'rules', 'skills', 'memory'];

/** startup: in context before the first prompt. on-demand: loads later. ignored: never loads. */
export type Load = 'startup' | 'on-demand' | 'ignored';

export interface SkillInfo {
  name: string;
  description: string;
  whenToUse?: string;
  /** POSIX path of the SKILL.md, relative to root (or "~/..." for user skills). */
  bodyPath: string;
}

export interface LoadedItem {
  agent: ToolId;
  /** POSIX path relative to root; user files start with "~/". */
  path: string;
  scope: 'project' | 'user';
  category: Category;
  load: Load;
  /** Why it loads this way, e.g. "CLAUDE.md in ancestor", "globs: src/**\/*.ts". */
  reason: string;
  /** Exactly what the agent injects. For a skill: its listing entry, not the body. */
  text: string;
  /** UTF-8 bytes of text. */
  bytes: number;
  /** Estimated tokens of text, filled by analyze(). */
  tokens: number;
  /** Path of the file whose @import pulled this in. */
  importedFrom?: string;
  /** Load order within the agent; the simulator relies on it. */
  order: number;
  skill?: SkillInfo;
}

export type LoaderItem = Omit<LoadedItem, 'tokens'>;

export interface Warning {
  agent?: ToolId;
  path?: string;
  message: string;
}

export interface LoaderContext {
  /** Absolute repo root (nearest ancestor with .git, else cwd). */
  root: string;
  /** Absolute directory the agent starts in. */
  cwd: string;
  /** Home directory; set only with --include-user (tests pass a fake one). */
  home?: string;
  env: Record<string, string | undefined>;
  /** Context window from --context, in tokens. */
  contextTokens?: number;
}

export interface LoaderResult {
  items: LoaderItem[];
  warnings: Warning[];
}

/** A documented source for a limit: where it comes from and when it was last checked. */
export interface Source {
  url: string;
  /** ISO date the value was last checked against this source. */
  checked: string;
  note?: string;
}

/** Limits a declarative tool can have. Every one needs a source in ToolSpec.sources. */
export interface SpecLimits {
  /** A file longer than this is cut. */
  maxFileBytes?: number;
  /** Combined size of all startup instruction files; the file crossing it is cut, later ones dropped. */
  maxTotalBytes?: number;
  /** A rule longer than this many characters may be cut or ignored by the tool; reported as at-risk. */
  maxFileChars?: number;
  /** Skill listing (names + descriptions) is capped at this many bytes; later skills are dropped. */
  skillListingMaxBytes?: number;
  /** A skill description longer than this is flagged (the tool warns or rejects it). */
  skillDescriptionMaxChars?: number;
  /** A recommendation only: files over this many lines are flagged, not cut. */
  recommendedMaxLines?: number;
}

/** A rules folder: every file matching glob under dir (relative to the repo root) is a rule. */
export interface RuleSpec {
  dir: string;
  /** Matched against the path inside dir; default: every .md file at any depth. */
  glob?: string;
  /** How rules load when they have no frontmatter mode. Default "startup". */
  load?: 'startup' | 'on-demand';
  /** Frontmatter key that picks the mode, e.g. "trigger". */
  modeKey?: string;
  /** Values of modeKey that load at startup; any other value is on-demand. */
  startupModes?: string[];
  /** Frontmatter key whose presence makes the rule conditional (on-demand), e.g. "paths". */
  conditionalKey?: string;
}

/**
 * A tool described as data: which files it loads and its limits. Built-in tools and tools
 * from ctxsize.json use the same shape.
 */
export interface ToolSpec {
  label: string;
  defaultContextTokens?: number;
  /** File names or globs, relative to each searched directory. */
  instructions?: string[];
  /**
   * Which directories are searched: repo root down to cwd (default), cwd only, root only, or
   * "nearest": from cwd up to the root, only the first directory that has a match counts.
   */
  search?: 'root-to-cwd' | 'cwd' | 'root' | 'nearest';
  /** In each directory only the first pattern that matches loads. */
  firstMatchOnly?: boolean;
  /** Same-named files in folders below cwd: on-demand (default) or ignored. */
  nested?: 'on-demand' | 'ignore';
  /** When instruction files load. Default "startup"; "on-demand" for files the user must pass in. */
  instructionLoad?: 'startup' | 'on-demand';
  rules?: RuleSpec[];
  /** Folders (relative to the repo root) holding <skill>/SKILL.md. */
  skills?: { dirs: string[] };
  limits?: SpecLimits;
  sources?: Source[];
  /** Shown under the tool in reports, e.g. what the model does not cover. */
  notes?: string[];
}

export type Loader = (ctx: LoaderContext) => Promise<LoaderResult>;

export type DropKind =
  | 'file-truncated'
  | 'file-dropped'
  | 'import-too-deep'
  | 'skill-description-truncated'
  | 'skill-description-dropped'
  | 'skill-omitted'
  | 'over-recommended-size'
  | 'legacy';

/** will: documented and certain. at-risk: depends on usage we cannot see. advice: kept, but past a recommendation. */
export type Certainty = 'will' | 'at-risk' | 'advice';

export interface Drop {
  agent: ToolId;
  kind: DropKind;
  certainty: Certainty;
  path?: string;
  skill?: string;
  bytesLost?: number;
  tokensLost?: number;
  /** Profile key of the limit, e.g. "codex.projectDocMaxBytes". */
  limit: string;
}

/** The model a tool was measured with. */
export interface ModelInfo {
  id: string;
  label: string;
  contextTokens: number;
  /** "o200k_base", "cl100k_base" or "~3.5 chars per token". */
  tokenizer: string;
  /** True when the tokenizer is the model's own, so counts are exact; false: an estimate. */
  exactTokenizer: boolean;
  /** USD per 1M uncached input tokens; null when no price is known. */
  pricePer1MInput: number | null;
  /** True when ctxsize picked the model; pass --model or set it in ctxsize.json to choose. */
  isDefault: boolean;
}

export interface AgentReport {
  agent: ToolId;
  label: string;
  model: ModelInfo;
  contextTokens: number;
  notes: string[];
  /** Startup tokens after drops. */
  startup: { total: number; byCategory: Record<Category, number> };
  onDemand: { total: number; count: number };
  items: LoadedItem[];
  drops: Drop[];
  warnings: Warning[];
}

export interface Report {
  schemaVersion: 2;
  tool: { name: 'ctxsize'; version: string };
  /** Always "." so output is reproducible. */
  root: '.';
  agents: AgentReport[];
}
