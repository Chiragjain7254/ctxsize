import { describe, expect, test } from 'vitest';
import { describePrice, PriceError, parsePrice, parseTokenCount } from '../src/core/price.ts';
import { fmt } from '../src/report/format.ts';
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

const repo = () =>
  tmpRepo({
    '.git/': '',
    'AGENTS.md': 'Use small commits. '.repeat(300),
    'CLAUDE.md': 'Be brief.\n',
  });

describe('parseTokenCount', () => {
  test.each([
    ['1000000', 1_000_000],
    ['1,000,000', 1_000_000],
    ['1_000', 1000],
    ['1k', 1000],
    ['1K', 1000],
    ['1m', 1_000_000],
    ['2.5M', 2_500_000],
    ['500k', 500_000],
  ])('%s is %d', (text, n) => {
    expect(parseTokenCount(text)).toBe(n);
  });

  test.each(['', 'abc', '1x', '-5', '1 million'])('"%s" is not a token count', (text) => {
    expect(parseTokenCount(text)).toBeNull();
  });
});

describe('parsePrice', () => {
  test('no --price means no price at all', () => {
    expect(parsePrice({})).toBeNull();
  });

  test('defaults: per one million tokens, in dollars', () => {
    expect(parsePrice({ price: '3' })).toEqual({ amount: 3, per: 1_000_000, currency: '$' });
  });

  test('per and currency are taken as given', () => {
    expect(parsePrice({ price: '250', per: '1m', currency: '₹' })).toEqual({
      amount: 250,
      per: 1_000_000,
      currency: '₹',
    });
    expect(parsePrice({ price: '0.5', per: '1k', currency: 'EUR' })).toEqual({
      amount: 0.5,
      per: 1000,
      currency: 'EUR',
    });
  });

  test('zero is a price (free); it is not the same as no price', () => {
    expect(parsePrice({ price: '0' })?.amount).toBe(0);
  });

  test.each([
    [{ price: 'abc' }, /--price must be a plain number/],
    [{ price: '-1' }, /--price must be a plain number/],
    [{ price: '$3' }, /put a symbol in --currency/],
    [{ price: '' }, /--price must be/],
    [{ price: '3', per: '0' }, /--per must be a token count/],
    [{ price: '3', per: 'lots' }, /--per must be a token count/],
    [{ price: '3', currency: '' }, /--currency must be/],
    [{ price: '3', currency: 'way too long' }, /--currency must be/],
    [{ per: '1m' }, /--per needs --price/],
    [{ currency: '₹' }, /--currency needs --price/],
  ])('%j is refused with a clear message', (input, message) => {
    expect(() => parsePrice(input)).toThrow(PriceError);
    expect(() => parsePrice(input)).toThrow(message);
  });

  test('describePrice reads back like a price list', () => {
    expect(describePrice({ amount: 250, per: 1_000_000, currency: '₹' }, fmt.withCurrency)).toBe(
      '₹250 per 1M tokens',
    );
    expect(describePrice({ amount: 0.5, per: 1000, currency: 'EUR' }, fmt.withCurrency)).toBe(
      '0.5 EUR per 1K tokens',
    );
  });
});

describe('cost in the CLI output', () => {
  test('without --price there is no cost anywhere, only a hint', async () => {
    const dir = repo();
    const term = (await cli(['--no-color'], dir)).stdout;
    expect(term).toContain('What each agent carries');
    expect(term).toContain('Add --price 3 --per 1m to see cost.');
    expect(term).not.toContain('Cost of carrying it');
    expect(term).not.toMatch(/Most expensive|Cheapest|\$\d|₹\d/);
    const md = (await cli(['--markdown', '-'], dir)).stdout;
    expect(md).not.toContain('Overhead cost');
    expect(md).toContain('Add --price 3 --per 1m to see cost.');
    const json = JSON.parse((await cli(['--json'], dir)).stdout);
    expect(json.price).toBeNull();
    for (const a of json.agents) expect(a.usage.overheadCost).toBeNull();
    expect(JSON.stringify(json)).not.toMatch(/pricePer1M|overheadCostUsd/);
  });

  test('with --price the cost is the tokens times the price, in your currency', async () => {
    const dir = repo();
    const json = JSON.parse(
      (await cli(['--json', '--price', '250', '--per', '1m', '--currency', '₹'], dir)).stdout,
    );
    expect(json.price).toEqual({ amount: 250, per: 1_000_000, currency: '₹' });
    for (const a of json.agents) {
      expect(a.usage.overheadCost).toBeCloseTo((a.usage.overheadTokens / 1e6) * 250, 5);
    }
  });

  test('--per changes the unit: the same price per 1k is a thousand times more', async () => {
    const dir = repo();
    const cost = async (extra: string[]) =>
      JSON.parse((await cli(['--json', '--agents', 'claude', ...extra], dir)).stdout).agents[0]
        .usage.overheadCost;
    const perMillion = await cost(['--price', '3']);
    const perThousand = await cost(['--price', '3', '--per', '1k']);
    expect(perThousand).toBeCloseTo(perMillion * 1000, 4);
    expect(await cost(['--price', '3', '--per', '1000000'])).toBeCloseTo(perMillion, 6);
  });

  test('the terminal and the Markdown show the cost with your symbol, and no hint', async () => {
    const dir = repo();
    const args = ['--price', '250', '--currency', '₹', '--no-color'];
    const term = (await cli(args, dir)).stdout;
    expect(term).toContain('Cost of carrying it');
    expect(term).toMatch(/₹\d/);
    expect(term).not.toContain('$');
    expect(term).not.toContain('Add --price');
    expect(term).toContain('₹250 per 1M tokens');
    const md = (await cli(['--markdown', '-', ...args], dir)).stdout;
    expect(md).toContain('Overhead cost');
    expect(md).toMatch(/₹\d/);
  });

  test('a currency code goes after the number', async () => {
    const term = (await cli(['--price', '3', '--currency', 'EUR', '--no-color'], repo())).stdout;
    expect(term).toMatch(/\d EUR/);
  });

  test('--sort cost works with or without a price', async () => {
    expect((await cli(['--sort', 'cost'], repo())).code).toBe(EXIT.ok);
    expect((await cli(['--sort', 'cost', '--price', '2'], repo())).code).toBe(EXIT.ok);
  });

  test.each([
    [['--price', 'abc'], /--price must be a plain number/],
    [['--price=-1'], /--price must be a plain number/],
    [['--price', '3', '--per', 'x'], /--per must be a token count/],
    [['--per', '1m'], /--per needs --price/],
    [['--currency', '₹'], /--currency needs --price/],
    [['--price', '3', '--currency', ''], /--currency must be/],
  ])('%j exits 2 with a clear line', async (argv, message) => {
    const r = await cli(argv, repo());
    expect(r.code).toBe(EXIT.usage);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(message);
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });

  test('--help documents the three flags', async () => {
    const help = (await cli(['--help'], repo())).stdout;
    for (const flag of ['--price <amount>', '--per <tokens>', '--currency <c>']) {
      expect(help).toContain(flag);
    }
  });
});

describe('an unknown context window', () => {
  const unknown = ['--model', 'qwen3.8-max', '--agents', 'codex'];

  test('a model without a stated window shows "unknown" and no % of window', async () => {
    const dir = repo();
    const term = (await cli([...unknown, '--no-color'], dir)).stdout;
    expect(term).toContain('unknown');
    const json = JSON.parse((await cli(['--json', ...unknown], dir)).stdout);
    expect(json.agents[0].contextTokens).toBeNull();
    expect(json.agents[0].usage.startupPctOfContext).toBeNull();
    expect((await cli(['--markdown', '-', ...unknown], dir)).stdout).toContain('unknown');
  });

  test('--context gives it a window, and --max-percent needs one', async () => {
    const dir = repo();
    const withContext = JSON.parse(
      (await cli(['--json', ...unknown, '--context', '100000'], dir)).stdout,
    );
    expect(withContext.agents[0].usage.startupPctOfContext).toBeGreaterThan(0);
    const gate = await cli([...unknown, '--max-percent', '50'], dir);
    expect(gate.code).toBe(EXIT.overBudget);
    expect(gate.stderr).toContain('context window is unknown');
  });
});
