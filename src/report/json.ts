import type { Report } from '../core/types.ts';

/**
 * Stable JSON for diffing and CI. File contents are left out: they can be large, and a
 * report pasted into a CI log or PR comment should not leak them.
 */
export function toJson(report: Report, extra: Record<string, unknown> = {}): string {
  const slim = {
    ...report,
    hidden: (report.hidden ?? []).map((h) => h.agent),
    tokensAreEstimates: report.agents.some((a) => !a.model.exactTokenizer),
    agents: report.agents.map((agent) => ({
      ...agent,
      // "exact" only for OpenAI models counted with their own tokenizer; all others are estimates.
      tokenCounts: agent.model.exactTokenizer ? 'exact' : 'estimate',
      items: agent.items.map(({ text: _text, ...item }) => item),
    })),
  };
  return `${JSON.stringify({ ...slim, ...extra }, null, 2)}\n`;
}
