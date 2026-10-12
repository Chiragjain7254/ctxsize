// Squarified treemap (Bruls, Huizing, van Wijk 2000). Pure geometry, no DOM.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed<T> extends Rect {
  datum: T;
}

/** Lays out values (any order) inside rect; zero and negative values are skipped. */
export function squarify<T>(data: T[], value: (d: T) => number, rect: Rect): Placed<T>[] {
  const items = data
    .map((datum) => ({ datum, v: value(datum) }))
    .filter((d) => d.v > 0)
    .sort((a, b) => b.v - a.v);
  const total = items.reduce((s, d) => s + d.v, 0);
  if (total === 0 || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const nodes = items.map((d) => ({ datum: d.datum, area: d.v * scale }));

  const out: Placed<T>[] = [];
  let free = { ...rect };
  let row: typeof nodes = [];

  const worst = (r: typeof nodes, side: number): number => {
    const sum = r.reduce((s, n) => s + n.area, 0);
    let max = 0;
    let min = Number.POSITIVE_INFINITY;
    for (const n of r) {
      max = Math.max(max, n.area);
      min = Math.min(min, n.area);
    }
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  const layoutRow = (r: typeof nodes): void => {
    const sum = r.reduce((s, n) => s + n.area, 0);
    if (free.w >= free.h) {
      // Column on the left, items stacked top to bottom.
      const width = sum / free.h;
      let y = free.y;
      for (const n of r) {
        const h = n.area / width;
        out.push({ datum: n.datum, x: free.x, y, w: width, h });
        y += h;
      }
      free = { x: free.x + width, y: free.y, w: free.w - width, h: free.h };
    } else {
      // Row on top, items side by side.
      const height = sum / free.w;
      let x = free.x;
      for (const n of r) {
        const w = n.area / height;
        out.push({ datum: n.datum, x, y: free.y, w, h: height });
        x += w;
      }
      free = { x: free.x, y: free.y + height, w: free.w, h: free.h - height };
    }
  };

  for (const node of nodes) {
    const side = Math.min(free.w, free.h);
    if (row.length === 0 || worst([...row, node], side) <= worst(row, side)) {
      row.push(node);
    } else {
      layoutRow(row);
      row = [node];
    }
  }
  if (row.length > 0) layoutRow(row);
  return out;
}
