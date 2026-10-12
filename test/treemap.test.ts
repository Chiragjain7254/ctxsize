import { expect, test } from 'vitest';
import { squarify } from '../src/report/treemap.ts';

const box = { x: 0, y: 0, w: 960, h: 540 };

test('rectangles tile the whole area', () => {
  const values = [500, 300, 120, 80, 60, 30, 10, 5, 1];
  const placed = squarify(values, (v) => v, box);
  expect(placed).toHaveLength(values.length);
  const area = placed.reduce((s, r) => s + r.w * r.h, 0);
  expect(Math.abs(area - box.w * box.h) / (box.w * box.h)).toBeLessThan(0.001);
  for (const r of placed) {
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
    expect(r.x + r.w).toBeLessThanOrEqual(box.w + 1e-6);
    expect(r.y + r.h).toBeLessThanOrEqual(box.h + 1e-6);
  }
});

test('area is proportional to value', () => {
  const placed = squarify([3, 1], (v) => v, box);
  const [big, small] = placed;
  expect((big?.w ?? 0) * (big?.h ?? 0)).toBeCloseTo(3 * (small?.w ?? 0) * (small?.h ?? 0), 3);
});

test('skips zero values and handles empty input', () => {
  expect(squarify([0, 0], (v) => v, box)).toEqual([]);
  expect(squarify([], (v: number) => v, box)).toEqual([]);
  expect(squarify([5, 0], (v) => v, box)).toHaveLength(1);
});

test('rectangles do not overlap', () => {
  const placed = squarify([9, 7, 6, 4, 3, 2, 2, 1], (v) => v, box);
  for (const [i, a] of placed.entries()) {
    for (const b of placed.slice(i + 1)) {
      const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      expect(overlapW <= 1e-6 || overlapH <= 1e-6).toBe(true);
    }
  }
});
