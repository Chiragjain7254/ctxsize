import { createHash } from 'node:crypto';
import { Tiktoken } from 'js-tiktoken/lite';
import cl100kBase from 'js-tiktoken/ranks/cl100k_base';
import o200kBase from 'js-tiktoken/ranks/o200k_base';

// Two public BPE tokenizers are built in, plus a characters-per-token ratio for models whose
// tokenizer is not available here (Llama, Qwen, DeepSeek, ...). Only the tokenizers a run
// actually needs are constructed: building one takes several hundred milliseconds.

export type TokenizerName = 'o200k_base' | 'cl100k_base';
export type Tokenizer = TokenizerName | { charsPerToken: number };

const ranks = { o200k_base: o200kBase, cl100k_base: cl100kBase };
const encoders = new Map<TokenizerName, Tiktoken>();

function encode(text: string, name: TokenizerName): number {
  let encoder = encoders.get(name);
  if (!encoder) {
    encoder = new Tiktoken(ranks[name]);
    encoders.set(name, encoder);
  }
  return encoder.encode(text, [], []).length;
}

/**
 * BPE is quadratic on a long run of one repeated character ("xxxx...", "=====..."):
 * 100 KB takes over a minute. Such runs are counted in fixed slices instead, which is
 * fast and within a token or two. Everything else is encoded exactly.
 */
const REPEAT_RUN = /(\S)\1{255,}/gu;
const SLICE = 64;

/**
 * Counts by content hash. --watch and --serve analyze the same repo again after every change, and
 * almost every file is unchanged, so a file whose text was counted before is not tokenized again.
 * Only the hash and the count are kept, never the text. The oldest entries go first.
 */
export const tokenCache = {
  /** Most counts kept. */
  limit: 20_000,
  hits: 0,
  misses: 0,
  counts: new Map<string, number>(),
  get size(): number {
    return this.counts.size;
  },
  clear(): void {
    this.counts.clear();
    this.hits = 0;
    this.misses = 0;
  },
};

/** Tokens in text: exact for a named tokenizer (cached), an estimate for { charsPerToken }. */
export function countTokens(text: string, tokenizer: Tokenizer = 'o200k_base'): number {
  if (text === '') return 0;
  if (typeof tokenizer === 'object') {
    return Math.ceil([...text].length / tokenizer.charsPerToken);
  }
  const key = `${tokenizer}:${createHash('sha1').update(text).digest('base64')}`;
  const known = tokenCache.counts.get(key);
  if (known !== undefined) {
    tokenCache.hits++;
    return known;
  }
  tokenCache.misses++;
  const count = encodeText(text, tokenizer);
  tokenCache.counts.set(key, count);
  while (tokenCache.counts.size > tokenCache.limit) {
    const oldest = tokenCache.counts.keys().next().value;
    if (oldest === undefined) break;
    tokenCache.counts.delete(oldest);
  }
  return count;
}

function encodeText(text: string, tokenizer: TokenizerName): number {
  let total = 0;
  let last = 0;
  for (const match of text.matchAll(REPEAT_RUN)) {
    total += encode(text.slice(last, match.index), tokenizer);
    const char = match[1] ?? '';
    const length = [...match[0]].length;
    total += Math.floor(length / SLICE) * encode(char.repeat(SLICE), tokenizer);
    if (length % SLICE) total += encode(char.repeat(length % SLICE), tokenizer);
    last = match.index + match[0].length;
  }
  if (last < text.length) total += encode(text.slice(last), tokenizer);
  return total;
}

/** How a tokenizer is named in reports, e.g. "o200k_base" or "~3.5 chars per token". */
export function tokenizerLabel(tokenizer: Tokenizer): string {
  return typeof tokenizer === 'object' ? `~${tokenizer.charsPerToken} chars per token` : tokenizer;
}

/** Size of the text in UTF-8 bytes, not characters. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
