import { Tiktoken } from 'js-tiktoken/lite';
import o200kBase from 'js-tiktoken/ranks/o200k_base';

// One public tokenizer for every agent keeps numbers comparable. Anthropic's tokenizer is
// not public, so every count is an estimate and is labelled so in all output.
let encoder: Tiktoken | undefined;

export function countTokens(text: string): number {
  if (text === '') return 0;
  encoder ??= new Tiktoken(o200kBase);
  return encoder.encode(text, [], []).length;
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
