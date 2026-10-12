import type { AgentId } from './core/types.ts';

// Every documented limit ctxsize relies on, with where it comes from and when it was checked.
// When an agent changes a limit, update the value, the source and the date together.
// No other file may hard-code one of these numbers.

export interface Source {
  url: string;
  /** ISO date the value was last checked against this source. */
  checked: string;
  note?: string;
}

interface BaseProfile {
  label: string;
  defaultContextTokens: number;
  sources: Source[];
  /** Agent-specific limits. */
  [limit: string]: unknown;
}

const CHECKED = '2026-10-12';

export const profiles = {
  claude: {
    label: 'Claude Code',
    defaultContextTokens: 200_000,
    /** @path imports recurse at most this many hops. */
    importMaxDepth: 4,
    /** Skill listing budget as a fraction of the context window. */
    skillListingBudgetFraction: 0.01,
    /** Env var that replaces the budget with a fixed character count. */
    skillListingCharBudgetEnv: 'SLASH_COMMAND_TOOL_CHAR_BUDGET',
    /** description + when_to_use are cut at this many characters per skill. */
    skillListingMaxDescChars: 1536,
    /** Auto memory MEMORY.md: only the first lines or bytes load, whichever is smaller. */
    memoryMaxLines: 200,
    memoryMaxBytes: 25 * 1024,
    sources: [
      { url: 'https://code.claude.com/docs/en/memory.md', checked: CHECKED },
      {
        url: 'https://code.claude.com/docs/en/skills.md',
        checked: CHECKED,
        note: 'Skill descriptions are cut short: 1% budget, 1,536-char cap, least-invoked dropped first',
      },
    ],
  },
  codex: {
    label: 'Codex',
    defaultContextTokens: 200_000,
    /** Combined AGENTS.md bytes; the file that crosses it is cut, later files are not read. */
    projectDocMaxBytes: 32 * 1024,
    /** Skill listing budget as a fraction of the context window... */
    skillListingBudgetFraction: 0.02,
    /** ...or this many characters when the context window is unknown. */
    skillListingFallbackChars: 8000,
    sources: [
      { url: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md', checked: CHECKED },
      { url: 'https://learn.chatgpt.com/docs/build-skills', checked: CHECKED },
      {
        url: 'https://github.com/openai/codex/blob/50d77959bf927293c4b5ddcca81d05331ae582ea/codex-rs/core/src/agents_md.rs',
        checked: CHECKED,
        note: 'Crossing file is truncated; separators do not count; whitespace-only files skipped',
      },
    ],
  },
  cursor: {
    label: 'Cursor',
    defaultContextTokens: 200_000,
    /** A recommendation, not a hard limit. */
    ruleRecommendedMaxLines: 500,
    sources: [{ url: 'https://cursor.com/docs/context/rules', checked: CHECKED }],
  },
  copilot: {
    label: 'GitHub Copilot',
    defaultContextTokens: 200_000,
    /** Copilot loads different files per surface; v0.1 models one. */
    surface: 'cloud-agent',
    sources: [
      {
        url: 'https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions',
        checked: CHECKED,
      },
      {
        url: 'https://docs.github.com/en/copilot/reference/custom-instructions-support',
        checked: CHECKED,
      },
    ],
  },
  gemini: {
    label: 'Gemini CLI',
    defaultContextTokens: 200_000,
    defaultFileNames: ['GEMINI.md'],
    importMaxDepth: 5,
    sources: [
      { url: 'https://geminicli.com/docs/cli/gemini-md/', checked: CHECKED },
      { url: 'https://geminicli.com/docs/cli/skills/', checked: CHECKED },
      {
        url: 'https://github.com/google-gemini/gemini-cli/blob/ff00dacd9f33d9842cfc3b5d6c53a1b2cbc44636/packages/core/src/utils/memoryImportProcessor.ts',
        checked: CHECKED,
        note: 'maxDepth: 5',
      },
    ],
  },
} as const satisfies Record<AgentId, BaseProfile>;

export type Profiles = typeof profiles;
