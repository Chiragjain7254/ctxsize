// schema/ctxsize.schema.json must agree with what ctxsize.json parsing accepts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import {
  ConfigError,
  LIMIT_KEYS,
  MODEL_KEYS,
  parseConfig,
  RULE_KEYS,
  TOOL_KEYS,
  TOP_KEYS,
} from '../src/config.ts';

const root = path.join(import.meta.dirname, '..');
const schema = JSON.parse(readFileSync(path.join(root, 'schema', 'ctxsize.schema.json'), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const accepted = (config: unknown): boolean => {
  try {
    parseConfig(config, 'ctxsize.json');
    return true;
  } catch (err) {
    if (err instanceof ConfigError) return false;
    throw err;
  }
};

/** The schema and the parser must agree on this config. */
const agree = (config: unknown, expected: boolean): void => {
  expect(validate(config), `schema: ${JSON.stringify(validate.errors)}`).toBe(expected);
  expect(accepted(config), 'parser').toBe(expected);
};

describe('schema/ctxsize.schema.json', () => {
  test('lists exactly the keys the parser allows', () => {
    const keys = (p: Record<string, unknown>) => Object.keys(p).sort();
    expect(keys(schema.properties)).toEqual([...TOP_KEYS].sort());
    expect(keys(schema.$defs.tool.properties)).toEqual([...TOOL_KEYS].sort());
    expect(keys(schema.$defs.rule.properties)).toEqual([...RULE_KEYS].sort());
    expect(keys(schema.$defs.limits.properties)).toEqual([...LIMIT_KEYS].sort());
    expect(keys(schema.$defs.model.properties)).toEqual([...MODEL_KEYS].sort());
  });

  test('accepts the example from docs/CONFIG.md', () => {
    const doc = readFileSync(path.join(root, 'docs', 'CONFIG.md'), 'utf8');
    const block = /```json\n([\s\S]*?)```/.exec(doc)?.[1] ?? '';
    agree(JSON.parse(block), true);
  });

  test('accepts a "$schema" key, exclude, budgets and models', () => {
    agree(
      {
        $schema: './node_modules/@chiragjain7254/ctxsize/schema/ctxsize.schema.json',
        messages: 80,
        exclude: ['docs/old/**', 'CLAUDE.local.md'],
        tools: { claude: { maxTokens: 9000, model: 'claude-haiku-5-5' } },
        models: { 'my-llama': { contextTokens: 128000, tokenizer: { charsPerToken: 3.8 } } },
      },
      true,
    );
  });

  test('rejects what the parser rejects', () => {
    for (const bad of [
      { typo: 1 },
      { messages: 0 },
      { messages: '80' },
      { exclude: '*.md' },
      { exclude: ['../x'] },
      { exclude: ['/abs'] },
      { exclude: ['a\\b'] },
      { tools: { Bad_Id: { label: 'x', instructions: ['X.md'] } } },
      { tools: { claude: { maxTokens: 0 } } },
      { tools: { acme: { label: 'x', instructions: ['X.md'], search: 'everywhere' } } },
      { tools: { acme: { label: 'x', instructions: ['X.md'], extra: true } } },
      { tools: { acme: { label: 'x', rules: [{ glob: '*.md' }] } } },
      { tools: { acme: { label: 'x', instructions: ['X.md'], limits: { maxFileBytes: 0 } } } },
      {
        tools: {
          acme: {
            label: 'x',
            instructions: ['X.md'],
            sources: [{ url: 'http://x', checked: '2026-10-15' }],
          },
        },
      },
      { models: { m: { tokenizer: 'gpt2' } } },
      { models: { m: { pricePer1MInput: -1 } } },
    ]) {
      agree(bad, false);
    }
  });

  test('is published in the npm package and has a ready-to-use $id', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.files).toContain('schema');
    expect(schema.$id).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/.+\/schema\/ctxsize\.schema\.json$/,
    );
  });
});
