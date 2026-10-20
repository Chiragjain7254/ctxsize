import { ConfigError } from './config.ts';
import type { Tokenizer } from './core/tokenize.ts';
import { tokenizerLabel } from './core/tokenize.ts';
import type { ModelInfo, ToolId } from './core/types.ts';
import { DEFAULT_CONTEXT_TOKENS } from './profiles.ts';

// Models a tool can be measured with: context window and tokenizer. ctxsize carries NO prices:
// prices change often and depend on your plan, so you give yours with --price (see docs/CLI.md).
// Every preset with a context window carries the official page that states it and the date it was
// checked. A window that could not be confirmed is null, and reports say "unknown" for it.

export interface Model {
  id: string;
  label: string;
  /** Tokens; null when the official docs do not state it (the report then says "unknown"). */
  contextTokens: number | null;
  tokenizer: Tokenizer;
  /** True when `tokenizer` is the model's own (OpenAI), so counts are exact. */
  exactTokenizer: boolean;
  /** The official page that states the context window; null for a window that is unknown or your own. */
  sourceUrl: string | null;
  /** The day the page above was read (YYYY-MM-DD). */
  checkedDate: string | null;
  /** A short caveat, for example why the window is unknown. */
  note?: string;
  origin: 'preset' | 'config';
}

/** A model definition from ctxsize.json; fields left out inherit from a preset of the same id. */
export interface UserModel {
  label?: string;
  contextTokens?: number;
  tokenizer?: Tokenizer;
}

const CHECKED = '2026-10-16';
const CLAUDE_DOCS = 'https://platform.claude.com/docs/en/about-claude/models/overview';

// PRESETS-START
// Claude's and Gemini's tokenizers are not public, so they are counted with o200k_base and
// labelled an estimate. The OpenAI pages do not name the tokenizer; o200k_base is the
// public one closest to current GPT models, so those are estimates too. Open models use a
// rough characters-per-token ratio: replace it in ctxsize.json if you know a better one.
export const presets: Omit<Model, 'origin'>[] = [
  {
    id: 'claude-fable-5-1',
    label: 'Claude Fable 5.1',
    contextTokens: 1_000_000,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    sourceUrl: CLAUDE_DOCS,
    checkedDate: CHECKED,
  },
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    contextTokens: 1_000_000,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    sourceUrl: CLAUDE_DOCS,
    checkedDate: CHECKED,
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    contextTokens: 1_000_000,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    sourceUrl: CLAUDE_DOCS,
    checkedDate: CHECKED,
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    contextTokens: 1_000_000,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    sourceUrl: CLAUDE_DOCS,
    checkedDate: CHECKED,
  },
  {
    id: 'gpt-6-astra',
    label: 'GPT-6 Astra',
    contextTokens: 1_050_000,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-6-astra',
    checkedDate: CHECKED,
  },
  {
    id: 'gpt-6-luna',
    label: 'GPT-6 Luna',
    contextTokens: 1_050_000,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
    checkedDate: CHECKED,
  },
  {
    id: 'gpt-5.3-codex',
    label: 'GPT-5.3-Codex',
    contextTokens: 400_000,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.3-codex',
    checkedDate: CHECKED,
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    contextTokens: 1_048_576,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview',
    checkedDate: CHECKED,
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    contextTokens: 1_048_576,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash',
    checkedDate: CHECKED,
  },
  {
    id: 'qwen3.8-max',
    label: 'Qwen3.8-Max',
    contextTokens: null,
    tokenizer: { charsPerToken: 3.5 },
    exactTokenizer: false,
    sourceUrl: null,
    checkedDate: null,
    note: 'The official Model Studio pages show a 1M pricing tier but do not state a context window',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    contextTokens: 1_000_000,
    tokenizer: { charsPerToken: 3.5 },
    exactTokenizer: false,
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    checkedDate: CHECKED,
  },
];
// PRESETS-END

/** Used when a caller of analyze() picks no models: the 200k window and tokenizer ctxsize v0.1 used. */
export const genericModel: Model = {
  id: 'generic',
  label: 'Generic (200k window)',
  contextTokens: DEFAULT_CONTEXT_TOKENS,
  tokenizer: 'o200k_base',
  exactTokenizer: false,
  sourceUrl: null,
  checkedDate: null,
  origin: 'preset',
};

/** The model assumed for a tool when the user picks none. Stated in reports as "default". */
export const defaultModelFor: Record<string, string> = {
  codex: 'gpt-5.3-codex',
  gemini: 'gemini-3.1-pro-preview',
};
const FALLBACK_MODEL = 'claude-sonnet-5-5';

export function allModels(user: Record<string, UserModel> = {}): Map<string, Model> {
  const models = new Map<string, Model>();
  for (const preset of presets) models.set(preset.id, { ...preset, origin: 'preset' });
  for (const [id, def] of Object.entries(user)) {
    const base = models.get(id);
    if (!base && (!def.label || !def.contextTokens || !def.tokenizer)) {
      throw new ConfigError(
        `models.${id}: a new model needs "label", "contextTokens" and "tokenizer"`,
      );
    }
    // A window you give is yours: it has no official page, and replaces an unknown one.
    const ownWindow = def.contextTokens !== undefined;
    models.set(id, {
      id,
      label: def.label ?? base?.label ?? id,
      contextTokens: def.contextTokens ?? base?.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
      tokenizer: def.tokenizer ?? base?.tokenizer ?? 'o200k_base',
      // A custom tokenizer or ratio is never the model's own.
      exactTokenizer: def.tokenizer ? false : (base?.exactTokenizer ?? false),
      sourceUrl: ownWindow ? null : (base?.sourceUrl ?? null),
      checkedDate: ownWindow ? null : (base?.checkedDate ?? null),
      origin: base && !def.label ? base.origin : 'config',
    });
  }
  return models;
}

export interface ModelChoice {
  /** Per tool id, from --model tool=model or the config. */
  perTool: Record<ToolId, string>;
  /** One model for every tool, from --model model. */
  all?: string;
}

/** Picks the model for a tool: explicit per-tool choice, then the global one, then the default. */
export function modelForTool(
  toolId: ToolId,
  models: Map<string, Model>,
  choice: ModelChoice,
): { model: Model; isDefault: boolean } {
  const wanted = choice.perTool[toolId] ?? choice.all;
  if (wanted !== undefined) {
    const model = models.get(wanted);
    if (!model) {
      throw new ConfigError(
        `unknown model "${wanted}" (choose from ${[...models.keys()].join(', ')})`,
      );
    }
    return { model, isDefault: false };
  }
  const id = defaultModelFor[toolId] ?? FALLBACK_MODEL;
  const model = models.get(id) ?? models.values().next().value;
  if (!model) throw new ConfigError('no models are defined');
  return { model, isDefault: true };
}

export function modelInfo(model: Model, isDefault: boolean): ModelInfo {
  return {
    id: model.id,
    label: model.label,
    contextTokens: model.contextTokens,
    tokenizer: tokenizerLabel(model.tokenizer),
    exactTokenizer: model.exactTokenizer,
    isDefault,
  };
}

export { CHECKED as MODELS_CHECKED };
