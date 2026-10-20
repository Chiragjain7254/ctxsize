// The numbers behind the interactive HTML report. This file has NO imports on purpose:
// createCalc() is copied into the page with Function.prototype.toString, so the code that
// runs in the browser is the code the unit tests run. Keep it plain and self-contained.

export interface CalcModel {
  id: string;
  label: string;
  /** Which count to use: one of the two BPE tokenizers, or chars / ratio. */
  tok: 'o200k_base' | 'cl100k_base' | 'ratio';
  ratio?: number;
  /** Tokens; null when the official docs do not state it. */
  window: number | null;
}

export interface CalcItem {
  key: string;
  category: string;
  load: 'startup' | 'on-demand' | 'ignored';
  /** True when the simulator dropped the whole file. */
  dropped?: boolean;
  /** Characters (code points) of the text the agent injects. */
  chars: number;
  /** Tokens with o200k_base and cl100k_base. */
  o: number;
  c: number;
}

export interface CalcAgent {
  /** Model the CLI measured this tool with. */
  model: string;
  /** Window as the CLI ran (it may come from --context); null when unknown. */
  window: number | null;
  items: CalcItem[];
}

export interface CalcAgentState {
  model: string;
  /** Item keys that are unticked. */
  off: Record<string, boolean>;
}

export interface CalcGlobal {
  /** Window override in tokens; null for none. */
  ctx: number | null;
  messages: number;
}

export interface CalcResult {
  startup: number;
  byCategory: Record<string, number>;
  onDemand: number;
  /** null when unknown. */
  window: number | null;
  /** null when the window is unknown. */
  windowPct: number | null;
  overheadTokens: number;
  model: string;
  /** True when the model or window differs from what the CLI simulated. */
  rechecked: boolean;
}

/** One price row of the calculator, as typed: every field is text, so half-typed input is kept. */
export interface CalcPriceRow {
  label: string;
  amount: string;
  /** A symbol ("$", "₹") or a code the person typed. */
  currency: string;
  /** "1k", "1m" or "custom". */
  perKind: string;
  perCustom: string;
  /** Optional: the cheaper price of a cached input token, per the same number of tokens. */
  cachedAmount: string;
}

/** A price row that is complete enough to use. */
export interface CalcPrice {
  label: string;
  amount: number;
  per: number;
  currency: string;
  /** null when no cached price was given. */
  cachedAmount: number | null;
}

export interface CalcCost {
  message: number;
  day: number;
  month: number;
}

export function createCalc() {
  type Tok = { tok: string; ratio?: number };

  /** Tokens of one item under a tokenizer. Ratio mode is ceil(chars / ratio), like the CLI. */
  function tokensOf(item: { chars: number; o: number; c: number }, m: Tok): number {
    if (m.tok === 'cl100k_base') return item.c;
    if (m.tok === 'ratio') {
      const r = m.ratio && m.ratio > 0 ? m.ratio : 4;
      return item.chars === 0 ? 0 : Math.ceil(item.chars / r);
    }
    return item.o;
  }

  function agentTotals(
    agent: CalcAgent,
    models: Record<string, CalcModel>,
    st: CalcAgentState,
    g: CalcGlobal,
  ): CalcResult {
    const run = st.model === agent.model;
    const m = models[st.model] ?? models[agent.model];
    const tok: Tok = m ?? { tok: 'o200k_base' };
    const byCategory: Record<string, number> = {};
    let startup = 0;
    let onDemand = 0;
    for (const item of agent.items) {
      if (st.off[item.key]) continue;
      if (item.load === 'on-demand') onDemand += tokensOf(item, tok);
      if (item.load !== 'startup' || item.dropped) continue;
      const t = tokensOf(item, tok);
      startup += t;
      byCategory[item.category] = (byCategory[item.category] ?? 0) + t;
    }
    const window = g.ctx !== null && g.ctx > 0 ? g.ctx : run || !m ? agent.window : m.window;
    const overheadTokens = startup * g.messages;
    return {
      startup,
      byCategory,
      onDemand,
      window,
      windowPct: window === null ? null : window > 0 ? (startup / window) * 100 : 0,
      overheadTokens,
      model: st.model,
      rechecked: !run || (g.ctx !== null && g.ctx !== agent.window),
    };
  }

  /** Sorts rows by a key, ties keep their order; strings sort case-insensitively, null last. */
  function sortRows<T>(rows: T[], get: (r: T) => string | number | null, dir: 1 | -1): T[] {
    return rows
      .map((r, i) => ({ r, i, v: get(r) }))
      .sort((a, b) => {
        if (a.v === null || b.v === null) {
          if (a.v === b.v) return a.i - b.i;
          return a.v === null ? 1 : -1;
        }
        const x = typeof a.v === 'string' ? a.v.toLowerCase() : a.v;
        const y = typeof b.v === 'string' ? b.v.toLowerCase() : b.v;
        if (x === y) return a.i - b.i;
        return (x < y ? -1 : 1) * dir;
      })
      .map((e) => e.r);
  }

  /** Moves the element at `from` to index `to`, returning a new array. */
  function move<T>(list: T[], from: number, to: number): T[] {
    if (from < 0 || from >= list.length) return list.slice();
    const t = Math.max(0, Math.min(list.length - 1, to));
    const out = list.slice();
    const [x] = out.splice(from, 1);
    out.splice(t, 0, x as T);
    return out;
  }

  /** "1k", "1m", "2.5M", "1,000,000": a token count the way people write it; null when it is not one. */
  function parseCount(text: string): number | null {
    const m = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(
      String(text)
        .trim()
        .replace(/[,_\s]/g, ''),
    );
    if (!m) return null;
    const unit = (m[2] ?? '').toLowerCase();
    const n = Number(m[1]) * (unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : 1);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  /** A plain number, 0 or more, from text such as "250" or "0.5"; null when it is not one. */
  function parseAmount(text: string): number | null {
    const t = String(text).trim().replace(/,/g, '');
    return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
  }

  /** The row as a usable price, or null while the amount (or a custom "per") is missing or wrong. */
  function priceOf(row: CalcPriceRow, fallbackLabel: string): CalcPrice | null {
    const amount = parseAmount(row.amount);
    if (amount === null) return null;
    const per = row.perKind === 'custom' ? parseCount(row.perCustom) : parseCount(row.perKind);
    if (per === null) return null;
    const cached = row.cachedAmount.trim() === '' ? null : parseAmount(row.cachedAmount);
    return {
      label: row.label.trim() === '' ? fallbackLabel : row.label.trim(),
      amount,
      per,
      currency: row.currency.trim(),
      cachedAmount: cached,
    };
  }

  /** The price per `per` tokens once a share of the messages is cached (0 to 100). */
  function blendedAmount(price: CalcPrice, cachedPct: number): number {
    const share = price.cachedAmount === null ? 0 : Math.min(100, Math.max(0, cachedPct)) / 100;
    return price.amount * (1 - share) + (price.cachedAmount ?? 0) * share;
  }

  /** What `tokens` of startup text cost per message, per day and per month at this price. */
  function costOf(
    tokens: number,
    price: CalcPrice,
    cachedPct: number,
    msgsPerDay: number,
    daysPerMonth: number,
  ): CalcCost {
    const message = (tokens / price.per) * blendedAmount(price, cachedPct);
    const day = message * msgsPerDay;
    return { message, day, month: day * daysPerMonth };
  }

  return {
    tokensOf,
    agentTotals,
    sortRows,
    move,
    parseCount,
    parseAmount,
    priceOf,
    blendedAmount,
    costOf,
  };
}

export const calc = createCalc();
