import { expect, test } from 'vitest';
import { createFmt, fmt } from '../src/report/format.ts';

test('money is written in your own currency: a symbol goes in front, a code after', () => {
  expect(fmt.money(null)).toBe('n/a');
  expect(fmt.money(0)).toBe('$0');
  expect(fmt.money(0.00001, '₹')).toBe('<₹0.0001');
  expect(fmt.money(0.0123, '$')).toBe('$0.0123');
  expect(fmt.money(0.4085, '₹')).toBe('₹0.4085');
  expect(fmt.money(1.2, '€')).toBe('€1.20');
  expect(fmt.money(12.5, 'EUR')).toBe('12.50 EUR');
  expect(fmt.money(0.00001, 'EUR')).toBe('<0.0001 EUR');
});

test('one percent format: <0.1%, one decimal under 10%, whole numbers above', () => {
  expect(fmt.pct(0)).toBe('0%');
  expect(fmt.pct(0.04)).toBe('<0.1%');
  expect(fmt.pct(0.36)).toBe('0.4%');
  expect(fmt.pct(9.96)).toBe('10%');
  expect(fmt.pct(12.4)).toBe('12%');
});

test('createFmt has no outside dependencies, so the page can run a copy of it', () => {
  const copy = new Function(`return (${createFmt.toString()})()`)();
  expect(copy.pct(0.36)).toBe('0.4%');
  expect(copy.num(3819.6)).toBe('3,820');
  expect(copy.plural(1, 'file', 'files')).toBe('file');
  expect(copy.money(1.5, '₹')).toBe('₹1.50');
});
