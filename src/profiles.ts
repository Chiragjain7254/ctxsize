import type { AgentId, Source, ToolSpec } from './core/types.ts';

export type { Source };

// Every documented limit ctxsize relies on, with where it comes from and when it was checked.
// When an agent changes a limit, update the value, the source and the date together.
// No other file may hard-code one of these numbers.

interface BaseProfile {
  label: string;
  defaultContextTokens: number;
  sources: Source[];
  /** Agent-specific limits. */
  [limit: string]: unknown;
}

const CHECKED = '2026-10-13';

/** Used for every tool whose docs do not state a context window. */
export const DEFAULT_CONTEXT_TOKENS = 200_000;

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
        note: 'Skill descriptions are cut short: 1% budget (skillListingBudgetFraction or SLASH_COMMAND_TOOL_CHAR_BUDGET raise it), 1,536-char cap, least-invoked dropped first',
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
        note: 'maxDepth: 5 (from the source; the GEMINI.md docs page does not state an import depth)',
      },
    ],
  },
} as const satisfies Record<AgentId, BaseProfile>;

// Tools described as data (ToolSpec). Where a tool's docs are silent we say so in `notes`
// instead of guessing, and no limit is set. None of these tools documents a default
// context window, so they use ctxsize's general default.
export const specProfiles: Record<string, ToolSpec> = {
  opencode: {
    label: 'OpenCode',
    instructions: ['AGENTS.md', 'CLAUDE.md'],
    search: 'nearest',
    firstMatchOnly: true,
    nested: 'ignore',
    skills: { dirs: ['.opencode/skills', '.claude/skills', '.agents/skills'] },
    limits: { skillDescriptionMaxChars: 1024 },
    sources: [
      {
        url: 'https://opencode.ai/docs/rules/',
        checked: CHECKED,
        note: 'AGENTS.md wins over CLAUDE.md; first match only; no size cap documented',
      },
      {
        url: 'https://opencode.ai/docs/skills/',
        checked: CHECKED,
        note: 'Skill description is 1-1024 characters',
      },
    ],
    notes: [
      'Files listed under "instructions" in opencode.json are not read; only AGENTS.md / CLAUDE.md.',
      'Where the upward search stops is undocumented; ctxsize stops at the repo root.',
    ],
  },
  cline: {
    label: 'Cline',
    instructions: ['AGENTS.md', '.cursorrules', '.windsurfrules'],
    search: 'root',
    nested: 'ignore',
    rules: [
      { dir: '.clinerules', glob: '*.md', conditionalKey: 'paths' },
      { dir: '.cline/rules', glob: '*.md', conditionalKey: 'paths' },
    ],
    skills: { dirs: ['.cline/skills', '.clinerules/skills', '.claude/skills'] },
    limits: { skillDescriptionMaxChars: 1024 },
    sources: [
      {
        url: 'https://docs.cline.bot/features/cline-rules',
        checked: CHECKED,
        note: 'No rule size cap documented; rules with `paths:` are conditional',
      },
      {
        url: 'https://docs.cline.bot/customization/skills',
        checked: CHECKED,
        note: 'Skill description at most 1024 characters',
      },
    ],
    notes: ['Rules are read from .md files only; other extensions are not modelled.'],
  },
  windsurf: {
    label: 'Windsurf',
    instructions: ['AGENTS.md', '.windsurfrules'],
    search: 'root',
    nested: 'on-demand',
    rules: [
      {
        dir: '.devin/rules',
        glob: '**/*.md',
        modeKey: 'trigger',
        startupModes: ['always_on'],
      },
      {
        dir: '.windsurf/rules',
        glob: '**/*.md',
        modeKey: 'trigger',
        startupModes: ['always_on'],
      },
    ],
    skills: { dirs: ['.devin/skills', '.windsurf/skills', '.agents/skills'] },
    limits: { maxFileChars: 12_000 },
    sources: [
      {
        url: 'https://docs.devin.ai/desktop/cascade/memories',
        checked: CHECKED,
        note: 'Workspace rules are limited to 12,000 characters each; triggers: always_on, model_decision, glob, manual',
      },
      {
        url: 'https://docs.devin.ai/desktop/cascade/agents-md',
        checked: CHECKED,
        note: 'Root AGENTS.md is always on; subdirectory AGENTS.md applies to its directory',
      },
      { url: 'https://docs.devin.ai/desktop/cascade/skills', checked: CHECKED },
    ],
    notes: [
      'A rule without a `trigger` is counted as always on (the docs do not say).',
      'model_decision rules put only their description in the prompt; they are counted as on-demand.',
      'The 6,000-character global rules file is in your home directory and is not read.',
    ],
  },
  aider: {
    label: 'Aider',
    instructions: ['CONVENTIONS.md'],
    search: 'root',
    instructionLoad: 'on-demand',
    nested: 'ignore',
    sources: [
      {
        url: 'https://aider.chat/docs/usage/conventions.html',
        checked: CHECKED,
        note: 'Conventions files load only when passed with --read or `read:` in .aider.conf.yml',
      },
      {
        url: 'https://aider.chat/docs/repomap.html',
        checked: CHECKED,
        note: 'Repo map budget --map-tokens defaults to 1k tokens',
      },
    ],
    notes: [
      'Aider loads no instruction file by itself. CONVENTIONS.md counts only if you pass it with --read.',
      'The repo map (about 1,000 tokens by default) is not counted. Aider has no skills.',
    ],
  },
  zed: {
    label: 'Zed',
    instructions: [
      '.rules',
      '.cursorrules',
      '.windsurfrules',
      '.clinerules',
      '.github/copilot-instructions.md',
      'AGENT.md',
      'AGENTS.md',
      'CLAUDE.md',
      'GEMINI.md',
    ],
    search: 'root',
    firstMatchOnly: true,
    nested: 'ignore',
    skills: { dirs: ['.agents/skills'] },
    limits: { skillListingMaxBytes: 50 * 1024, skillDescriptionMaxChars: 1024 },
    sources: [
      {
        url: 'https://zed.dev/docs/ai/instructions',
        checked: '2026-10-18',
        note: 'First match wins in the listed order; no size cap documented',
      },
      {
        url: 'https://zed.dev/docs/ai/skills',
        checked: '2026-10-18',
        note: 'Skill catalog (names + descriptions) is capped at 50KB; overflow is dropped; descriptions over 1,024 characters warn',
      },
    ],
  },
};
