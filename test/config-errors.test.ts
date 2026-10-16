// A bad ctxsize.json must say which key is wrong, what was found, and how to fix it.
import { describe, expect, test } from 'vitest';
import { ConfigError, loadConfig, parseConfig } from '../src/config.ts';
import { EXIT, run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

const message = (raw: unknown): string => {
  try {
    parseConfig(raw, 'ctxsize.json');
  } catch (err) {
    if (err instanceof ConfigError) return err.message;
    throw err;
  }
  throw new Error('expected a ConfigError');
};

describe('unknown keys', () => {
  test('suggest the closest allowed key', () => {
    expect(message({ mesages: 5 })).toBe(
      'ctxsize.json: unknown key "mesages" (did you mean "messages"?) (allowed: $schema, tools, models, messages, exclude)',
    );
    expect(message({ tools: { x: { label: 'x', instructoins: ['a'] } } })).toContain(
      'tools.x: unknown key "instructoins" (did you mean "instructions"?)',
    );
    expect(message({ tools: { x: { label: 'x', limits: { maxFileByte: 1 } } } })).toContain(
      'unknown key "maxFileByte" (did you mean "maxFileBytes"?)',
    );
  });

  test('suggest nothing when nothing is close', () => {
    const text = message({ banana: 1 });
    expect(text).toContain('unknown key "banana" (allowed:');
    expect(text).not.toContain('did you mean');
  });
});

describe('wrong types say what was found', () => {
  test.each([
    [
      { messages: '80' },
      'ctxsize.json: messages: expected a positive whole number, got "80" (a string)',
    ],
    [{ messages: 1.5 }, 'messages: expected a positive whole number, got 1.5 (a number)'],
    [{ messages: null }, 'messages: expected a positive whole number, got null'],
    [{ tools: [] }, '"tools" must be an object, got a list'],
    [{ models: 'x' }, '"models" must be an object, got "x" (a string)'],
    [{ exclude: '*.md' }, 'exclude: expected a non-empty list, got "*.md" (a string)'],
    [{ tools: { x: 'oops' } }, 'tools.x: expected an object, got "oops" (a string)'],
    [
      { tools: { x: { label: 'x', instructions: ['a'], firstMatchOnly: 'yes' } } },
      'tools.x.firstMatchOnly: expected true or false, got "yes" (a string)',
    ],
    [
      { tools: { x: { label: 'x', instructions: ['a'], rules: {} } } },
      'tools.x.rules: expected a list, got an object',
    ],
    [
      { tools: { x: { label: 'x', instructions: ['a'], skills: [] } } },
      'tools.x.skills: expected an object, got a list',
    ],
    [
      { tools: { x: { label: 7, instructions: ['a'] } } },
      'tools.x.label: expected a non-empty string, got 7 (a number)',
    ],
    [
      { models: { m: { pricePer1MInput: 2 } } },
      'models.m.pricePer1MInput: ctxsize has no prices of its own any more; give yours on the command line, for example --price 3 --per 1m',
    ],
    [
      { models: { m: { tokenizer: 'gpt2' } } },
      'models.m.tokenizer: expected "o200k_base", "cl100k_base" or { "charsPerToken": 3.5 }, got "gpt2" (a string)',
    ],
    [
      { models: { m: { tokenizer: { charsPerToken: 50 } } } },
      'charsPerToken: expected a number between 0 and 20, got 50 (a number)',
    ],
    [
      {
        tools: {
          x: { label: 'x', instructions: ['a'], sources: [{ url: 'https://a', checked: 'today' }] },
        },
      },
      'sources[0].checked: expected YYYY-MM-DD',
    ],
  ])('%j', (raw, expected) => {
    expect(message(raw)).toContain(expected);
  });

  test('a wrong choice lists the choices and suggests the closest', () => {
    expect(
      message({ tools: { x: { label: 'x', instructions: ['a'], search: 'roots' } } }),
    ).toContain(
      'tools.x.search: expected one of root-to-cwd, cwd, root, nearest (did you mean "root"?), got "roots" (a string)',
    );
  });

  test('long strings are shortened', () => {
    expect(message({ messages: 'x'.repeat(100) })).toContain(`"${'x'.repeat(37)}..." (a string)`);
  });
});

describe('invalid JSON', () => {
  const broken = '{\n  "messages": 80,\n  "tools": {\n}\n';

  test('says where, using the file name', () => {
    const root = tmpRepo({ 'ctxsize.json': broken });
    let text = '';
    try {
      loadConfig(root);
    } catch (err) {
      text = (err as Error).message;
    }
    expect(text).toMatch(/^ctxsize\.json: invalid JSON: /);
    expect(text).toMatch(/line \d+/);
  });

  test('a ctxsize key in package.json is checked, a broken package.json is not ours to report', () => {
    expect(() => loadConfig(tmpRepo({ 'package.json': '{ not json' }))).not.toThrow();
    const root = tmpRepo({ 'package.json': JSON.stringify({ ctxsize: { mesages: 1 } }) });
    expect(() => loadConfig(root)).toThrow('package.json "ctxsize": unknown key "mesages"');
  });
});

describe('on the command line', () => {
  async function cli(argv: string[], cwd: string) {
    let stderr = '';
    const code = await run(argv, {
      stdout: () => {},
      stderr: (t) => {
        stderr += t;
      },
      env: {},
      isTTY: false,
      cwd,
    });
    return { code, stderr };
  }

  test('a bad config is exit 2 with the message and no stack trace', async () => {
    const root = tmpRepo({ '.git/': '', 'ctxsize.json': '{ "mesages": 5 }' });
    const r = await cli([], root);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain(
      'ctxsize: ctxsize.json: unknown key "mesages" (did you mean "messages"?)',
    );
    expect(r.stderr).not.toContain('    at ');
  });

  test('invalid JSON is exit 2', async () => {
    const root = tmpRepo({ '.git/': '', 'ctxsize.json': '{ nope' });
    const r = await cli(['--json'], root);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain('ctxsize.json: invalid JSON');
  });

  test('every flag that reads the config reports the same error', async () => {
    const root = tmpRepo({ '.git/': '', 'ctxsize.json': '{ "messages": "many" }' });
    for (const argv of [[], ['--json'], ['--html'], ['--tree'], ['--history', '2']]) {
      const r = await cli(argv, root);
      expect(r.code, argv.join(' ')).toBe(EXIT.usage);
      expect(r.stderr, argv.join(' ')).toContain('got "many" (a string)');
    }
  });
});
