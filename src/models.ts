import { ConfigError } from './config.ts';
import type { Tokenizer } from './core/tokenize.ts';
import { tokenizerLabel } from './core/tokenize.ts';
import type { ModelInfo, Source, ToolId } from './core/types.ts';
import { DEFAULT_CONTEXT_TOKENS } from './profiles.ts';

// Models a tool can be measured with: context window, tokenizer and input price.
// Every preset carries the source of its numbers and the date they were checked. Prices and
// windows change often; override them in ctxsize.json ("models") when yours differ.

export interface Model {
  id: string;
  label: string;
  contextTokens: number;
  tokenizer: Tokenizer;
  /** True when `tokenizer` is the model's own (OpenAI), so counts are exact. */
  exactTokenizer: boolean;
  /** USD per 1M uncached input tokens. */
  pricePer1MInput?: number;
  sources: Source[];
  origin: 'preset' | 'config';
}

/** A model definition from ctxsize.json; fields left out inherit from a preset of the same id. */
export interface UserModel {
  label?: string;
  contextTokens?: number;
  tokenizer?: Tokenizer;
  pricePer1MInput?: number;
  sources?: Source[];
}

const CHECKED = '2026-10-13';

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
    pricePer1MInput: 10,
    sources: [
      { url: 'https://platform.claude.com/docs/en/about-claude/models/overview', checked: CHECKED },
      { url: 'https://platform.claude.com/docs/en/about-claude/pricing', checked: CHECKED },
    ],
  },
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    contextTokens: 1_000_000,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    pricePer1MInput: 4,
    sources: [
      { url: 'https://platform.claude.com/docs/en/about-claude/models/overview', checked: CHECKED },
      { url: 'https://platform.claude.com/docs/en/about-claude/pricing', checked: CHECKED },
    ],
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    contextTokens: 1_000_000,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    pricePer1MInput: 2,
    sources: [
      { url: 'https://platform.claude.com/docs/en/about-claude/models/overview', checked: CHECKED },
      { url: 'https://platform.claude.com/docs/en/about-claude/pricing', checked: CHECKED },
    ],
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    contextTokens: 1_000_000,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    // $0.10 for prompts up to 100k tokens, $0.50 above; startup context is far below 100k.
    pricePer1MInput: 0.1,
    sources: [
      { url: 'https://platform.claude.com/docs/en/about-claude/models/overview', checked: CHECKED },
      { url: 'https://platform.claude.com/docs/en/about-claude/pricing', checked: CHECKED },
    ],
  },
  {
    id: 'gpt-6-astra',
    label: 'GPT-6 Astra',
    contextTokens: 1_050_000,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    pricePer1MInput: 10,
    sources: [
      { url: 'https://developers.openai.com/api/docs/models/gpt-6-astra', checked: CHECKED },
      { url: 'https://developers.openai.com/api/docs/pricing', checked: CHECKED },
    ],
  },
  {
    id: 'gpt-6-luna',
    label: 'GPT-6 Luna',
    contextTokens: 1_050_000,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    pricePer1MInput: 0.1,
    sources: [
      { url: 'https://developers.openai.com/api/docs/models/gpt-6-luna', checked: CHECKED },
      { url: 'https://developers.openai.com/api/docs/pricing', checked: CHECKED },
    ],
  },
  {
    id: 'gpt-5.3-codex',
    label: 'GPT-5.3-Codex',
    contextTokens: 400_000,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    pricePer1MInput: 1.75,
    sources: [
      { url: 'https://developers.openai.com/api/docs/models/gpt-5.3-codex', checked: CHECKED },
      { url: 'https://developers.openai.com/api/docs/pricing', checked: CHECKED },
    ],
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    contextTokens: 1_048_576,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    // $2 up to a 200k prompt, $4 above.
    pricePer1MInput: 2,
    sources: [
      {
        url: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview',
        checked: CHECKED,
      },
      { url: 'https://ai.google.dev/gemini-api/docs/pricing', checked: CHECKED },
    ],
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    contextTokens: 1_048_576,
    tokenizer: 'o200k_base',
    exactTokenizer: false,
    // $0.75 through 2026-12-31, $1.50 from 2027-01-01.
    pricePer1MInput: 0.75,
    sources: [
      { url: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash', checked: CHECKED },
      { url: 'https://ai.google.dev/gemini-api/docs/pricing', checked: CHECKED },
    ],
  },
  {
    id: 'qwen3.8-max',
    label: 'Qwen3.8-Max',
    contextTokens: 1_000_000,
    tokenizer: { charsPerToken: 3.5 },
    exactTokenizer: false,
    pricePer1MInput: 2,
    sources: [
      {
        url: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
        checked: CHECKED,
        note: 'First pricing tier (Singapore); the chars-per-token ratio is a rough assumption',
      },
    ],
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    contextTokens: 1_000_000,
    tokenizer: { charsPerToken: 3.5 },
    exactTokenizer: false,
    // Peak price on a cache miss; $0.66 off-peak.
    pricePer1MInput: 1.32,
    sources: [
      {
        url: 'https://api-docs.deepseek.com/quick_start/pricing',
        checked: CHECKED,
        note: 'The chars-per-token ratio is a rough assumption',
      },
    ],
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
  sources: [],
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
    models.set(id, {
      id,
      label: def.label ?? base?.label ?? id,
      contextTokens: def.contextTokens ?? base?.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
      tokenizer: def.tokenizer ?? base?.tokenizer ?? 'o200k_base',
      // A custom tokenizer or ratio is never the model's own.
      exactTokenizer: def.tokenizer ? false : (base?.exactTokenizer ?? false),
      ...(def.pricePer1MInput !== undefined
        ? { pricePer1MInput: def.pricePer1MInput }
        : base?.pricePer1MInput !== undefined
          ? { pricePer1MInput: base.pricePer1MInput }
          : {}),
      sources: def.sources ?? base?.sources ?? [],
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

export function modelInfo(model: Model, isDefault: boolean, priceOverride?: number): ModelInfo {
  const price = priceOverride ?? model.pricePer1MInput;
  return {
    id: model.id,
    label: model.label,
    contextTokens: model.contextTokens,
    tokenizer: tokenizerLabel(model.tokenizer),
    exactTokenizer: model.exactTokenizer,
    pricePer1MInput: price ?? null,
    isDefault,
  };
}

export { CHECKED as MODELS_CHECKED };
