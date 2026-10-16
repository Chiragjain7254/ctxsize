import type { Price } from './types.ts';

// ctxsize has no prices of its own: prices change often and depend on your plan. A price exists
// only when the user gives one with --price (plus --per and --currency).

export class PriceError extends Error {}

/** The default `per`: one million tokens. */
export const DEFAULT_PER = 1_000_000;

/**
 * A token count the way people write it: 1000000, 1,000,000, 1_000_000, 1k, 1m, 2.5m.
 * Returns null when the text is not one.
 */
export function parseTokenCount(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(text.trim().replace(/[,_]/g, ''));
  if (!m) return null;
  const unit = (m[2] ?? '').toLowerCase();
  const n = Number(m[1]) * (unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export interface PriceInput {
  price?: string | undefined;
  per?: string | undefined;
  currency?: string | undefined;
}

/** Turns --price, --per and --currency into a Price, or null when no price was given. */
export function parsePrice(input: PriceInput): Price | null {
  const { price, per, currency } = input;
  if (price === undefined) {
    if (per !== undefined)
      throw new PriceError('--per needs --price, for example --price 3 --per 1m');
    if (currency !== undefined) {
      throw new PriceError('--currency needs --price, for example --price 250 --currency ₹');
    }
    return null;
  }
  const amountText = price.trim().replace(/,/g, '');
  const amount = /^\d+(?:\.\d+)?$/.test(amountText) ? Number(amountText) : Number.NaN;
  if (!Number.isFinite(amount)) {
    throw new PriceError(
      `--price must be a plain number such as 3 or 0.25 (put a symbol in --currency), got "${price}"`,
    );
  }
  let perTokens = DEFAULT_PER;
  if (per !== undefined) {
    const n = parseTokenCount(per);
    if (n === null || n < 1) {
      throw new PriceError(`--per must be a token count such as 1000, 1k or 1m, got "${per}"`);
    }
    perTokens = n;
  }
  let symbol = '$';
  if (currency !== undefined) {
    const c = currency.trim();
    if (c === '' || c.length > 8 || /\s/.test(c) || /\p{C}/u.test(c)) {
      throw new PriceError(
        `--currency must be a symbol or a code of up to 8 characters, such as $, ₹, EUR or "kr", got "${currency}"`,
      );
    }
    symbol = c;
  }
  return { amount, per: perTokens, currency: symbol };
}

/** The price as a short phrase for reports: "₹250 per 1M tokens". */
export function describePrice(
  p: Price,
  withCurrency: (text: string, currency: string) => string,
): string {
  const per =
    p.per % 1_000_000 === 0
      ? `${p.per / 1_000_000}M`
      : p.per % 1000 === 0
        ? `${p.per / 1000}K`
        : String(p.per);
  return `${withCurrency(String(+p.amount.toFixed(6)), p.currency)} per ${per} tokens`;
}
