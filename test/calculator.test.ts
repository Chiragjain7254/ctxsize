import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { type CalcPriceRow, calc } from '../src/report/calc.ts';
import { renderHtml } from '../src/report/html.ts';
import { tmpRepo } from './helpers.ts';
import { dataOf, html, runPage } from './page-helper.ts';

vi.setConfig({ testTimeout: 30_000 });

const row = (over: Partial<CalcPriceRow> = {}): CalcPriceRow => ({
  label: '',
  amount: '',
  currency: '$',
  perKind: '1m',
  perCustom: '',
  cachedAmount: '',
  ...over,
});

describe('the calculator maths', () => {
  test('parseCount reads 1k, 1m, 2.5M and 1,000,000; nothing else', () => {
    expect(calc.parseCount('1k')).toBe(1000);
    expect(calc.parseCount('1m')).toBe(1_000_000);
    expect(calc.parseCount('2.5M')).toBe(2_500_000);
    expect(calc.parseCount('1,000,000')).toBe(1_000_000);
    for (const bad of ['', 'abc', '0', '-3', '1x']) expect(calc.parseCount(bad), bad).toBeNull();
  });

  test('a row is a price only when the amount (and a custom "per") are usable', () => {
    expect(calc.priceOf(row(), 'Your price')).toBeNull();
    expect(calc.priceOf(row({ amount: 'abc' }), 'x')).toBeNull();
    expect(calc.priceOf(row({ amount: '3', perKind: 'custom', perCustom: '' }), 'x')).toBeNull();
    expect(calc.priceOf(row({ amount: '3' }), 'Your price')).toEqual({
      label: 'Your price',
      amount: 3,
      per: 1_000_000,
      currency: '$',
      cachedAmount: null,
    });
    expect(
      calc.priceOf(row({ amount: '0.5', perKind: 'custom', perCustom: '500k', label: ' A ' }), 'x'),
    ).toMatchObject({ label: 'A', per: 500_000, amount: 0.5 });
  });

  test('cost per message, per day and per month: 1,634 tokens × ₹250 / 1,000,000', () => {
    const price = calc.priceOf(row({ amount: '250', currency: '₹' }), 'x');
    if (!price) throw new Error('no price');
    const c = calc.costOf(1634, price, 0, 50, 22);
    expect(c.message).toBeCloseTo(0.4085, 6);
    expect(c.day).toBeCloseTo(20.425, 6);
    expect(c.month).toBeCloseTo(449.35, 6);
  });

  test('"per 1K" costs a thousand times more per token than "per 1M" at the same number', () => {
    const m = calc.priceOf(row({ amount: '3' }), 'x');
    const k = calc.priceOf(row({ amount: '3', perKind: '1k' }), 'x');
    if (!m || !k) throw new Error('no price');
    expect(calc.costOf(1000, k, 0, 1, 1).message).toBeCloseTo(
      calc.costOf(1000, m, 0, 1, 1).message * 1000,
    );
  });

  test('a cached price and a share of cached messages blend the price; without a cached price they do nothing', () => {
    const cached = calc.priceOf(row({ amount: '250', cachedAmount: '25' }), 'x');
    if (!cached) throw new Error('no price');
    expect(calc.blendedAmount(cached, 70)).toBeCloseTo(92.5);
    expect(calc.blendedAmount(cached, 0)).toBe(250);
    expect(calc.blendedAmount(cached, 250)).toBe(25); // capped at 100%
    const plain = calc.priceOf(row({ amount: '250' }), 'x');
    if (!plain) throw new Error('no price');
    expect(calc.blendedAmount(plain, 70)).toBe(250);
  });
});

const REPO = {
  'AGENTS.md': `${'Use npm. '.repeat(100)}\n`,
  '.claude/skills/nodesc/SKILL.md': '---\nname: nodesc\n---\nBody\n',
};

describe('the Cost calculator tab', () => {
  test('is a tab, with the disclaimer in plain words above the results', async () => {
    const out = await html(REPO);
    const nav = runPage(out)('nav');
    expect([...nav.matchAll(/data-act="view" data-id="(\w+)"/g)].map((m) => m[1])).toEqual([
      'overview',
      'agents',
      'fixes',
      'cost',
      'settings',
      'help',
    ]);
    expect(nav).toContain('Cost calculator');
    const at = (s: string) => out.indexOf(s);
    expect(at('Rough estimate from your price')).toBeGreaterThan(at('id="view-cost"'));
    expect(at('Rough estimate from your price')).toBeLessThan(at('id="calc-results"'));
    expect(out).toContain(
      "Rough estimate from your price and ctxsize's token count. Real cost depends on caching and your plan. On a monthly subscription (Claude Pro, Cursor Pro…) you don't pay per token, so watch tokens instead.",
    );
  });

  test('with no price it says so, and shows no cost and no zeros anywhere', async () => {
    const out = await html(REPO);
    const page = runPage(out);
    expect(page('calc-results')).toContain('Enter your price to see cost');
    expect(page('calc-results')).not.toMatch(/\d/);
    // The Overview chart has no cost cells either.
    expect(page('compare')).not.toMatch(/[$₹€£]\s?\d/);
    expect(page('compare')).toContain('<span class="co"></span>');
    expect(page('panel')).toContain('tokens over');
    // The inputs start with the default 50 messages a day and 22 days a month.
    const inputs = page('calc-inputs');
    expect(inputs).toContain('value="50"');
    expect(inputs).toContain('value="22"');
  });

  test('typing a price shows cost per message, day and month for every shown agent, cheapest first', async () => {
    const out = await html(REPO);
    const data = dataOf(out);
    const page = runPage(out);
    page.pick('currencyKind', 0, '₹');
    page.type('amount', 0, '250');
    const results = page('calc-results');
    expect(results).toContain('Per message');
    expect(results).toContain('Per day');
    expect(results).toContain('Per month');
    expect(results).toMatch(/₹\d/);
    expect(results).not.toContain('$');
    expect(results).toContain('Cheapest');
    // One row per shown agent.
    expect(results.match(/<tr class="/g)).toHaveLength(data.agents.length);
    // The worked example shows the arithmetic with the person's own numbers.
    expect(results).toMatch(
      /Worked example<\/b> for [^:]+: ~?[\d,]+ tokens × ₹250 \/ 1,000,000 = ₹[\d.,]+ per message/,
    );
    // Sorted: the cheapest (the fewest tokens, but not an agent that reads nothing) is first.
    const first = /<tr class="cheapest"><td>([^<]+)/.exec(results)?.[1];
    expect(first).toBeDefined();
    expect(results.indexOf('class="cheapest"')).toBeLessThan(results.indexOf('<tr class="">'));
  });

  test('the cost follows messages per day and working days per month', async () => {
    const page = runPage(await html(REPO));
    page.type('amount', 0, '100');
    const month = (r: string) =>
      Number(
        /Per month[\s\S]*?<td class="r">₹?\$?([\d,.]+)<\/td><\/tr>/.exec(r)?.[1]?.replace(/,/g, ''),
      );
    const before = page('calc-results');
    page.type('msgsDay', 0, '100');
    const after = page('calc-results');
    expect(after).not.toBe(before);
    expect(month(after)).not.toBeNaN();
    expect(after).toContain('× 100 messages');
    page.type('days', 0, '10');
    expect(page('calc-results')).toContain('× 10 days');
  });

  test('Compare another price adds a labelled row and says which is cheaper for the repo', async () => {
    const page = runPage(await html(REPO));
    page.type('amount', 0, '250');
    page.click('calc-add');
    expect(page('calc-inputs')).toContain('Model A');
    expect(page('calc-inputs')).toContain('Model B');
    page.type('amount', 1, '100');
    const results = page('calc-results');
    expect(results).toContain('Model A');
    expect(results).toContain('Model B');
    expect(results).toContain('<b>Model B</b> is the cheaper price for your repo');
    expect(results).toContain('60% less');
    // Both prices side by side: six cost columns.
    expect(results.match(/Per month/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test('prices in different currencies are shown but not compared', async () => {
    const page = runPage(await html(REPO));
    page.type('amount', 0, '250');
    page.click('calc-add');
    page.type('amount', 1, '3');
    page.pick('currencyKind', 1, '€');
    const results = page('calc-results');
    expect(results).toContain('different currencies');
    expect(results).not.toContain('is the cheaper price');
  });

  test('a price can be removed again, and the first one cannot', async () => {
    const page = runPage(await html(REPO));
    page.click('calc-add');
    expect(page('calc-inputs')).toContain('Compare: price 2');
    page.click('calc-del', '1');
    expect(page('calc-inputs')).not.toContain('Compare: price 2');
    page.click('calc-del', '0');
    expect(page('calc-inputs')).toContain('Your price');
  });

  test('the optional cached price lowers the cost, and is clearly marked optional', async () => {
    const page = runPage(await html(REPO));
    page.type('amount', 0, '250');
    const plain = /Worked example[\s\S]*?= ([^ ]+) per message/.exec(page('calc-results'))?.[1];
    expect(page('calc-inputs')).toContain('Cheaper cached price (optional)');
    page.type('cachedAmount', 0, '25');
    page.type('cachedPct', 0, '70');
    const cached = /Worked example[\s\S]*?= ([^ ]+) per message/.exec(page('calc-results'))?.[1];
    expect(cached).not.toBe(plain);
    expect(page('calc-results')).toContain('blended with your cached price');
  });

  test('the inputs are remembered in this browser, and a blocked or damaged store is fine', async () => {
    const out = await html(REPO);
    const page = runPage(out);
    page.type('amount', 0, '250');
    page.type('msgsDay', 0, '80');
    const saved = JSON.parse(page.storage.get('ctxsize-calc') ?? 'null');
    expect(saved.rows[0].amount).toBe('250');
    expect(saved.msgsDay).toBe('80');
    // The next visit starts with them.
    const again = runPage(out, { storage: { 'ctxsize-calc': JSON.stringify(saved) } });
    expect(again('calc-results')).toContain('Per month');
    expect(again('calc-inputs')).toContain('value="80"');
    // Blocked or damaged storage: the page still works, from empty.
    expect(runPage(out, { blocked: true })('calc-results')).toContain('Enter your price');
    expect(runPage(out, { storage: { 'ctxsize-calc': '{nope' } })('calc-results')).toContain(
      'Enter your price',
    );
    const odd = runPage(out, { storage: { 'ctxsize-calc': '{"rows":[1,null,{"amount":"5"}]}' } });
    expect(odd('calc-results')).toContain('Per month');
  });

  test('a price given with --price fills the first row', async () => {
    const root = tmpRepo({ '.git/': '', ...REPO });
    const report = await analyze({
      cwd: path.join(root),
      price: { amount: 250, per: 1_000_000, currency: '₹' },
    });
    const page = runPage(renderHtml(report));
    expect(page('calc-inputs')).toContain('value="250"');
    expect(page('calc-results')).toMatch(/₹\d/);
    expect(page('compare')).toMatch(/<span class="co">₹[\d,.]+<\/span>/);
  });

  test('Show cost on the Overview shows the monthly cost once a price is entered; "See cost" opens the tab', async () => {
    const page = runPage(await html(REPO));
    page.type('amount', 0, '3');
    expect(page('compare')).toMatch(/<span class="co">\$[\d,.]+<\/span>/);
    expect(page('compare')).toContain('data-act="view" data-id="cost"');
    page.click('view', 'cost');
    expect(page.hash()).toBe('#cost');
  });

  test('Reset forgets the calculator', async () => {
    const page = runPage(await html(REPO), {
      storage: { 'ctxsize-calc': JSON.stringify({ rows: [{ amount: '9' }], msgsDay: '7' }) },
    });
    expect(page('calc-results')).toContain('Per month');
    page.click('reset');
    expect(page('calc-results')).toContain('Enter your price');
    expect(page.storage.get('ctxsize-calc')).toBe('');
  });

  test('every input and column has a tooltip with a definition', async () => {
    const out = await html(REPO);
    const page = runPage(out);
    page.type('amount', 0, '250');
    page.click('calc-add');
    const drawn = new Set([...page.all().matchAll(/data-help="([a-z-]+)"/g)].map((m) => m[1]));
    for (const id of [
      'price',
      'per',
      'currency',
      'price-label',
      'msgs-day',
      'work-days',
      'cached-price',
      'cached-share',
      'compare-price',
      'cost-message',
      'cost-day',
      'cost-month',
      'cheapest',
    ]) {
      expect(drawn, id).toContain(id);
      expect(out, id).toContain(`<div id="h-${id}">`);
    }
  });

  test('no built-in price is anywhere in the page', async () => {
    const out = await html(REPO);
    expect(out).not.toMatch(/pricePer1M|"price":\{/);
    expect(dataOf(out).price).toBeNull();
  });
});
