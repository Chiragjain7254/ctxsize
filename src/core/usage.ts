import type { Category, LoadedItem, TopFile, Usage } from './types.ts';

/** How many messages a session is assumed to have when the overhead is estimated. */
export const DEFAULT_MESSAGES = 50;

/**
 * Startup context is sent with every request, so its cost grows with the conversation:
 * overhead = startup tokens x messages. Cost uses the uncached input price, so prompt
 * caching would make the real number lower.
 */
export function usageFor(
  startupTokens: number,
  contextTokens: number,
  messages: number,
  pricePer1MInput: number | null,
): Usage {
  const overheadTokens = startupTokens * messages;
  return {
    startupPctOfContext: round(contextTokens > 0 ? (startupTokens / contextTokens) * 100 : 0, 2),
    messages,
    overheadTokens,
    overheadCostUsd:
      pricePer1MInput === null ? null : round((overheadTokens / 1e6) * pricePer1MInput, 6),
  };
}

/** The items that cost the most at startup, biggest first (ties by path, for stable output). */
export function topFiles(items: LoadedItem[], limit = 5): TopFile[] {
  return items
    .filter((i) => i.load === 'startup' && i.tokens > 0)
    .map((i) => ({
      path: i.path,
      tokens: i.tokens,
      category: i.category as Category,
      ...(i.skill ? { skill: i.skill.name } : {}),
    }))
    .sort((a, b) => b.tokens - a.tokens || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, limit);
}

/** "$0.0123", "$1.20", "<$0.0001" or "n/a" when no price is known. */
export function formatUsd(usd: number | null): string {
  if (usd === null) return 'n/a';
  if (usd === 0) return '$0';
  if (usd < 0.0001) return '<$0.0001';
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
