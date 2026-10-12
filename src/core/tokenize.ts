import { Tiktoken } from 'js-tiktoken/lite';
import o200kBase from 'js-tiktoken/ranks/o200k_base';

// One public tokenizer for every agent keeps numbers comparable. Anthropic's tokenizer is
// not public, so every count is an estimate and is labelled so in all output.
let encoder: Tiktoken | undefined;

function encode(text: string): number {
  encoder ??= new Tiktoken(o200kBase);
  return encoder.encode(text, [], []).length;
}

/**
 * BPE is quadratic on a long run of one repeated character ("xxxx...", "=====..."):
 * 100 KB takes over a minute. Such runs are counted in fixed slices instead, which is
 * fast and within a token or two. Everything else is encoded exactly.
 */
const REPEAT_RUN = /(\S)\1{255,}/gu;
const SLICE = 64;

export function countTokens(text: string): number {
  if (text === '') return 0;
  let total = 0;
  let last = 0;
  for (const match of text.matchAll(REPEAT_RUN)) {
    total += encode(text.slice(last, match.index));
    const char = match[1] ?? '';
    const length = [...match[0]].length;
    total += Math.floor(length / SLICE) * encode(char.repeat(SLICE));
    if (length % SLICE) total += encode(char.repeat(length % SLICE));
    last = match.index + match[0].length;
  }
  if (last < text.length) total += encode(text.slice(last));
  return total;
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
