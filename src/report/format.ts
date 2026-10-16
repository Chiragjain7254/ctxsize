// The one place numbers become text. The terminal, the share card and the HTML page all use
// this, so a number is written the same way everywhere. createFmt() is copied into the page with
// Function.prototype.toString, so it must have no imports and use nothing from outside itself.

export function createFmt() {
  /** 3820.4 -> "3,820" */
  const num = (n: number): string => Math.round(n).toLocaleString('en-US');

  /** A share of the context window: "0%", "<0.1%", "0.4%", "12%". */
  const pct = (n: number): string =>
    n === 0 ? '0%' : n < 0.1 ? '<0.1%' : n < 9.95 ? `${n.toFixed(1)}%` : `${Math.round(n)}%`;

  /** "$0.0123", "$1.20", "<$0.0001" or "n/a" when no price is known. */
  const usd = (v: number | null): string => {
    if (v === null) return 'n/a';
    if (v === 0) return '$0';
    if (v < 0.0001) return '<$0.0001';
    return `$${v.toFixed(v < 1 ? 4 : 2)}`;
  };

  const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

  return { num, pct, usd, plural };
}

export type Fmt = ReturnType<typeof createFmt>;

export const fmt = createFmt();
