import type { Report } from './core/types.ts';

// The CI gates: limits that turn a report into exit code 1. Each failure is one stderr line.

export interface Gates {
  /** --max-tokens: no agent may load more than this at startup. */
  maxTokens?: number | undefined;
  /** --max-percent: no agent may use more than this share of its context window at startup. */
  maxPercent?: number | undefined;
  /** tools.<id>.maxTokens from ctxsize.json: a startup budget per tool. */
  budgets?: Record<string, number> | undefined;
}

const n = (value: number): string => value.toLocaleString('en-US');

/** One message per broken gate; an empty list means the report passes. */
export function gateFailures(report: Report, gates: Gates): string[] {
  const failures: string[] = [];
  for (const agent of report.agents) {
    if (gates.maxTokens !== undefined && agent.startup.total > gates.maxTokens) {
      failures.push(
        `${agent.label} loads ${n(agent.startup.total)} tokens at startup, over --max-tokens ${n(gates.maxTokens)}`,
      );
    }
    const budget = gates.budgets?.[agent.agent];
    if (budget !== undefined && agent.startup.total > budget) {
      failures.push(
        `${agent.label} loads ${n(agent.startup.total)} tokens at startup, over its budget of ${n(budget)} (tools.${agent.agent}.maxTokens in ctxsize.json)`,
      );
    }
    const pct = agent.usage.startupPctOfContext;
    if (gates.maxPercent !== undefined && pct > gates.maxPercent) {
      failures.push(
        `${agent.label} uses ${pct}% of its ${n(agent.contextTokens)}-token context window at startup, over --max-percent ${gates.maxPercent}`,
      );
    }
  }
  return failures;
}
