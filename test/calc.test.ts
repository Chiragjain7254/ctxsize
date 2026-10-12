import { describe, expect, test } from 'vitest';
import {
  type CalcAgent,
  type CalcGlobal,
  type CalcItem,
  type CalcModel,
  calc,
  createCalc,
} from '../src/report/calc.ts';

const models: Record<string, CalcModel> = {
  a: { id: 'a', label: 'A', tok: 'o200k_base', window: 200_000, price: 3 },
  b: { id: 'b', label: 'B', tok: 'cl100k_base', window: 100_000, price: 1 },
  r: { id: 'r', label: 'R', tok: 'ratio', ratio: 4, window: 50_000, price: null },
  free: { id: 'free', label: 'Free', tok: 'o200k_base', window: 10_000, price: 0 },
};

const item = (key: string, o: number, c: number, chars: number, extra: Partial<CalcItem> = {}) => ({
  key,
  category: 'instructions',
  load: 'startup' as const,
  chars,
  o,
  c,
  ...extra,
});

const agent: CalcAgent = {
  model: 'a',
  window: 200_000,
  price: 3,
  items: [
    item('x.md', 1000, 1100, 4000),
    item('y.md', 500, 450, 1802, { category: 'rules' }),
    item('skill#s', 100, 90, 330, { category: 'skills' }),
    item('od.md', 700, 700, 2800, { load: 'on-demand' }),
    item('gone.md', 9000, 9000, 36000, { load: 'ignored', dropped: true }),
  ],
};
const g: CalcGlobal = { ctx: null, messages: 50, price: null };
const st = (model = 'a', off: string[] = []) => ({
  model,
  off: Object.fromEntries(off.map((k) => [k, true])),
});

describe('agentTotals', () => {
  test('sums startup items, skips on-demand and dropped ones', () => {
    const r = calc.agentTotals(agent, models, st(), g);
    expect(r.startup).toBe(1600);
    expect(r.byCategory).toEqual({ instructions: 1000, rules: 500, skills: 100 });
    expect(r.onDemand).toBe(700);
    expect(r.rechecked).toBe(false);
  });

  test('percent of window, overhead tokens and cost', () => {
    const r = calc.agentTotals(agent, models, st(), g);
    expect(r.window).toBe(200_000);
    expect(r.windowPct).toBeCloseTo(0.8);
    expect(r.overheadTokens).toBe(80_000);
    expect(r.costUsd).toBeCloseTo(0.24);
  });

  test('unticking a file removes it from every total', () => {
    const r = calc.agentTotals(agent, models, st('a', ['x.md']), g);
    expect(r.startup).toBe(600);
    expect(r.byCategory.instructions).toBeUndefined();
    expect(r.windowPct).toBeCloseTo(0.3);
    expect(r.costUsd).toBeCloseTo(0.09);
    expect(calc.agentTotals(agent, models, st('a', ['x.md', 'y.md', 'skill#s']), g).startup).toBe(
      0,
    );
  });

  test('switching to the other BPE tokenizer uses its counts and the new window and price', () => {
    const r = calc.agentTotals(agent, models, st('b'), g);
    expect(r.startup).toBe(1640);
    expect(r.window).toBe(100_000);
    expect(r.price).toBe(1);
    expect(r.rechecked).toBe(true);
    expect(r.costUsd).toBeCloseTo((1640 * 50) / 1e6);
  });

  test('ratio mode is ceil(chars / ratio) per item', () => {
    const r = calc.agentTotals(agent, models, st('r'), g);
    expect(r.startup).toBe(1000 + 451 + 83); // 4000/4, ceil(1802/4), ceil(330/4)
    expect(r.window).toBe(50_000);
  });

  test('ratio mode with an empty item is zero, with a bad ratio falls back to 4', () => {
    expect(calc.tokensOf({ chars: 0, o: 0, c: 0 }, { tok: 'ratio', ratio: 3 })).toBe(0);
    expect(calc.tokensOf({ chars: 9, o: 0, c: 0 }, { tok: 'ratio', ratio: 0 })).toBe(3);
  });

  test('a context override wins over every model window', () => {
    const over = { ...g, ctx: 4000 };
    expect(calc.agentTotals(agent, models, st(), over).windowPct).toBeCloseTo(40);
    expect(calc.agentTotals(agent, models, st('b'), over).window).toBe(4000);
    expect(calc.agentTotals(agent, models, st(), over).rechecked).toBe(true);
  });

  test('the as-run window is kept for the as-run model (CLI --context)', () => {
    const cli = { ...agent, window: 123_000 };
    expect(calc.agentTotals(cli, models, st(), g).window).toBe(123_000);
    expect(calc.agentTotals(cli, models, st('b'), g).window).toBe(100_000);
  });

  test('messages scale overhead and cost', () => {
    const r = calc.agentTotals(agent, models, st(), { ...g, messages: 10 });
    expect(r.overheadTokens).toBe(16_000);
    expect(r.costUsd).toBeCloseTo(0.048);
    expect(calc.agentTotals(agent, models, st(), { ...g, messages: 0 }).costUsd).toBe(0);
  });

  test('a price override replaces the model price', () => {
    const r = calc.agentTotals(agent, models, st('b'), { ...g, price: 10 });
    expect(r.price).toBe(10);
    expect(r.costUsd).toBeCloseTo((1640 * 50 * 10) / 1e6);
  });

  test('no price or a zero price means cost is n/a', () => {
    expect(calc.agentTotals(agent, models, st('r'), g).costUsd).toBeNull();
    expect(calc.agentTotals(agent, models, st('free'), g).costUsd).toBeNull();
    expect(calc.agentTotals(agent, models, st(), { ...g, price: 0 }).costUsd).toBeNull();
    expect(calc.agentTotals({ ...agent, price: null }, models, st(), g).costUsd).toBeNull();
    expect(calc.usd(null)).toBe('n/a');
  });

  test('an unknown model id falls back to the as-run model', () => {
    expect(calc.agentTotals(agent, models, st('nope'), g).startup).toBe(1600);
  });
});

describe('helpers', () => {
  test('usd formats like the terminal report', () => {
    expect(calc.usd(0)).toBe('$0');
    expect(calc.usd(0.00001)).toBe('<$0.0001');
    expect(calc.usd(0.0123)).toBe('$0.0123');
    expect(calc.usd(1.2)).toBe('$1.20');
  });

  test('sortRows sorts numbers and strings, either way, nulls last, stable', () => {
    const rows = [
      { n: 'b', v: 2 },
      { n: 'A', v: null },
      { n: 'c', v: 2 },
      { n: 'a', v: 9 },
    ];
    expect(calc.sortRows(rows, (r) => r.v, -1).map((r) => r.n)).toEqual(['a', 'b', 'c', 'A']);
    expect(calc.sortRows(rows, (r) => r.v, 1).map((r) => r.n)).toEqual(['b', 'c', 'a', 'A']);
    expect(calc.sortRows(rows, (r) => r.n, 1).map((r) => r.n)).toEqual(['A', 'a', 'b', 'c']);
  });

  test('move reorders without mutating', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(calc.move(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(calc.move(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(calc.move(list, 1, 99)).toEqual(['a', 'c', 'd', 'b']);
    expect(calc.move(list, 9, 0)).toEqual(list);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  test('createCalc is self-contained: it runs when rebuilt from its source text', () => {
    const rebuilt = new Function(`return (${createCalc.toString()})()`)() as typeof calc;
    expect(rebuilt.agentTotals(agent, models, st('r'), g).startup).toBe(1534);
  });
});
