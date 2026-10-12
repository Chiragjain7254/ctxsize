// The contract every loader, the simulator and every report share. Frozen after M1:
// loaders are built in parallel against it, so changes here need a coordinated commit.

export type AgentId = 'claude' | 'codex' | 'cursor' | 'copilot' | 'gemini';
export const AGENT_IDS: readonly AgentId[] = ['claude', 'codex', 'cursor', 'copilot', 'gemini'];

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
  agent: AgentId;
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
  agent?: AgentId;
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
  agent: AgentId;
  kind: DropKind;
  certainty: Certainty;
  path?: string;
  skill?: string;
  bytesLost?: number;
  tokensLost?: number;
  /** Profile key of the limit, e.g. "codex.projectDocMaxBytes". */
  limit: string;
}

export interface AgentReport {
  agent: AgentId;
  label: string;
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
  schemaVersion: 1;
  tool: { name: 'ctxsize'; version: string };
  tokenizer: 'o200k_base (estimate)';
  /** Always "." so output is reproducible. */
  root: '.';
  agents: AgentReport[];
}
