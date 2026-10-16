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

  return { tokensOf, agentTotals, sortRows, move };
}

export const calc = createCalc();
