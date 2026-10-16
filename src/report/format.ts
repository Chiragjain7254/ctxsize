// The one place numbers become text. The terminal, the share card and the HTML page all use
// this, so a number is written the same way everywhere. createFmt() is copied into the page with
// Function.prototype.toString, so it must have no imports and use nothing from outside itself.

export function createFmt() {
  /** 3820.4 -> "3,820" */
  const num = (n: number): string => Math.round(n).toLocaleString('en-US');

  /** A share of the context window: "0%", "<0.1%", "0.4%", "12%". */
  const pct = (n: number): string =>
    n === 0 ? '0%' : n < 0.1 ? '<0.1%' : n < 9.95 ? `${n.toFixed(1)}%` : `${Math.round(n)}%`;

  /** Puts a number written as text next to its currency: a symbol in front, a code (letters) after. */
  const withCurrency = (text: string, currency = '$'): string =>
    /^[A-Za-z]{2,}$/.test(currency) ? `${text} ${currency}` : `${currency}${text}`;

  /**
   * Money in the user's own currency: "$0.0123", "₹1.20", "<₹0.0001" or "12.50 EUR".
   * null (no price given) is "n/a".
   */
  const money = (v: number | null, currency = '$'): string => {
    if (v === null) return 'n/a';
    if (v === 0) return withCurrency('0', currency);
    if (v < 0.0001) return `<${withCurrency('0.0001', currency)}`;
    return withCurrency(
      v < 1
        ? v.toFixed(4)
        : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      currency,
    );
  };

  const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

  return { num, pct, money, withCurrency, plural };
}

export type Fmt = ReturnType<typeof createFmt>;

export const fmt = createFmt();
