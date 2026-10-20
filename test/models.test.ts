import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { analyze } from '../src/core/analyze.ts';
import { countTokens, tokenizerLabel } from '../src/core/tokenize.ts';
import { allModels, modelForTool, presets } from '../src/models.ts';
import { EXIT, run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

async function cli(argv: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    env: {},
    isTTY: false,
    cwd,
  });
  return { code, stdout, stderr };
}

describe('tokenizers', () => {
  test('o200k_base and cl100k_base both count; empty text is 0', () => {
    expect(countTokens('hello world', 'o200k_base')).toBe(2);
    expect(countTokens('hello world', 'cl100k_base')).toBe(2);
    expect(countTokens('', 'cl100k_base')).toBe(0);
    // They are different vocabularies: the newer one needs fewer tokens for non-English text.
    expect(countTokens('Привет, как дела?', 'o200k_base')).toBe(6);
    expect(countTokens('Привет, как дела?', 'cl100k_base')).toBe(8);
  });

  test('a ratio tokenizer divides code points by chars per token, rounding up', () => {
    expect(countTokens('a'.repeat(35), { charsPerToken: 3.5 })).toBe(10);
    expect(countTokens('a'.repeat(36), { charsPerToken: 3.5 })).toBe(11);
    expect(countTokens('日本語', { charsPerToken: 1 })).toBe(3);
    expect(tokenizerLabel({ charsPerToken: 3.5 })).toBe('~3.5 chars per token');
  });
});

describe('presets', () => {
  test('every model with a context window has the official page that states it and a checked date', () => {
    expect(presets.length).toBeGreaterThanOrEqual(10);
    for (const m of presets) {
      if (m.contextTokens === null) continue;
      expect(m.contextTokens, m.id).toBeGreaterThan(1000);
      expect(m.sourceUrl, m.id).toMatch(/^https:\/\//);
      expect(m.checkedDate, m.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('a model whose window could not be confirmed is null, with a note saying so', () => {
    const unknown = presets.filter((m) => m.contextTokens === null);
    expect(unknown.map((m) => m.id)).toEqual(['qwen3.8-max']);
    for (const m of unknown) {
      expect(m.sourceUrl).toBeNull();
      expect(m.note, m.id).toMatch(/do not state a context window/);
    }
  });

  test('ctxsize carries no price: no model has one, and none is in the source', () => {
    for (const m of presets) expect(Object.keys(m), m.id).not.toContain('pricePer1MInput');
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'models.ts'), 'utf8');
    expect(src).not.toMatch(/pricePer1M|price:/i);
  });

  test('a ratio-mode preset is never marked exact', () => {
    for (const m of presets) {
      if (typeof m.tokenizer === 'object') expect(m.exactTokenizer).toBe(false);
    }
  });
});

describe('choosing models', () => {
  const models = allModels();

  test('defaults are flagged as defaults; explicit choices are not', () => {
    expect(modelForTool('claude', models, { perTool: {} }).isDefault).toBe(true);
    const picked = modelForTool('claude', models, { perTool: { claude: 'claude-haiku-5-5' } });
    expect(picked).toMatchObject({ isDefault: false, model: { id: 'claude-haiku-5-5' } });
    expect(modelForTool('zed', models, { perTool: {}, all: 'gpt-6-luna' }).model.id).toBe(
      'gpt-6-luna',
    );
  });

  test('config models add new ones and override fields of a preset', () => {
    const config = parseConfig(
      {
        models: {
          'my-llama': { label: 'My Llama', contextTokens: 128000, tokenizer: { charsPerToken: 4 } },
          'claude-sonnet-5-5': { contextTokens: 500_000 },
        },
      },
      'cfg',
    );
    const all = allModels(config.models);
    expect(all.get('my-llama')).toMatchObject({
      contextTokens: 128000,
      exactTokenizer: false,
      origin: 'config',
    });
    const sonnet = all.get('claude-sonnet-5-5');
    // Your own window replaces the official one, and then has no official page.
    expect(sonnet?.contextTokens).toBe(500_000);
    expect(sonnet?.sourceUrl).toBeNull();
    expect(all.get('claude-opus-5-5')?.sourceUrl).toMatch(/^https:/);
  });

  test('a price in ctxsize.json is refused with a pointer to --price', () => {
    expect(() => parseConfig({ models: { x: { pricePer1MInput: 3 } } }, 'cfg')).toThrow(
      /no prices of its own.*--price/,
    );
  });

  test('a new model needs label, window and tokenizer; bad tokenizers are rejected', () => {
    expect(() => allModels({ nope: { contextTokens: 5000 } })).toThrow(/needs "label"/);
    const bad = (tokenizer: unknown) =>
      parseConfig({ models: { x: { label: 'x', contextTokens: 1, tokenizer } } }, 'cfg');
    expect(() => bad('gpt2')).toThrow(/tokenizer/);
    expect(() => bad({ charsPerToken: 0 })).toThrow(/charsPerToken/);
    expect(() => bad({ charsPerToken: 3, extra: 1 })).toThrow(/unknown key/);
  });
});

describe('analysis with models', () => {
  const files = { '.git/': '', 'AGENTS.md': `# Rules\n\n${'Use small commits. '.repeat(200)}\n` };

  test('the model sets context window and tokenizer in the report', async () => {
    const repo = tmpRepo(files);
    const models = allModels();
    const report = await analyze({
      cwd: repo,
      agents: ['claude'],
      models: { models, choice: { perTool: { claude: 'gpt-5.3-codex' } } },
    });
    const claude = report.agents[0];
    expect(claude?.model).toMatchObject({
      id: 'gpt-5.3-codex',
      contextTokens: 400_000,
      tokenizer: 'o200k_base',
      isDefault: false,
    });
    expect(claude?.contextTokens).toBe(400_000);
  });

  test('--context beats the model window', async () => {
    const repo = tmpRepo(files);
    const report = await analyze({
      cwd: repo,
      agents: ['claude'],
      contextTokens: 50_000,
      models: { models: allModels(), choice: { perTool: {} } },
    });
    expect(report.agents[0]?.contextTokens).toBe(50_000);
  });

  test('a ratio model counts tokens from characters', async () => {
    const repo = tmpRepo({ '.git/': '', 'AGENTS.md': 'a'.repeat(700) });
    const models = allModels({
      r: { label: 'R', contextTokens: 100_000, tokenizer: { charsPerToken: 7 } },
    });
    const report = await analyze({
      cwd: repo,
      agents: ['opencode'],
      models: { models, choice: { perTool: {}, all: 'r' } },
    });
    expect(report.agents[0]?.startup.total).toBe(100);
    expect(report.agents[0]?.model.tokenizer).toBe('~7 chars per token');
  });

  test('different tools can use different tokenizers in one run', async () => {
    const repo = tmpRepo({ '.git/': '', 'AGENTS.md': 'hello world '.repeat(100) });
    const models = allModels({
      r: { label: 'R', contextTokens: 100_000, tokenizer: { charsPerToken: 3 } },
    });
    const report = await analyze({
      cwd: repo,
      agents: ['codex', 'zed'],
      models: { models, choice: { perTool: { zed: 'r' } } },
    });
    const [codex, zed] = report.agents;
    expect(codex?.model.tokenizer).toBe('o200k_base');
    expect(zed?.model.tokenizer).toBe('~3 chars per token');
    expect(codex?.startup.total).not.toBe(zed?.startup.total);
  });
});

describe('--model', () => {
  const repo = () => tmpRepo({ '.git/': '', 'AGENTS.md': 'Use npm.\n' });

  test('one id applies to every tool; tool=id pairs apply to one', async () => {
    const r = await cli(['--json', '--model', 'gpt-6-luna,zed=claude-haiku-5-5'], repo());
    expect(r.code).toBe(EXIT.ok);
    const byAgent = Object.fromEntries(
      JSON.parse(r.stdout).agents.map((a: { agent: string; model: { id: string } }) => [
        a.agent,
        a.model.id,
      ]),
    );
    expect(byAgent.claude).toBe('gpt-6-luna');
    expect(byAgent.zed).toBe('claude-haiku-5-5');
  });

  test.each([
    [['--model', 'nope'], /unknown model "nope"/],
    [['--model', 'nope=claude-haiku-5-5'], /unknown tool "nope"/],
  ])('%j exits 2', async (argv, message) => {
    const r = await cli(argv, repo());
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toMatch(message);
  });

  test('a tool model can be set in ctxsize.json, even for a hand-written tool', async () => {
    const dir = tmpRepo({
      '.git/': '',
      'ctxsize.json': JSON.stringify({ tools: { claude: { model: 'claude-opus-5-5' } } }),
    });
    const r = await cli(['--json', '--agents', 'claude'], dir);
    expect(JSON.parse(r.stdout).agents[0].model.id).toBe('claude-opus-5-5');
  });
});
