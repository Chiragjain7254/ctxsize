import type { Report } from '../core/types.ts';

/**
 * Stable JSON for diffing and CI. File contents are left out: they can be large, and a
 * report pasted into a CI log or PR comment should not leak them.
 */
export function toJson(report: Report, extra: Record<string, unknown> = {}): string {
  const slim = {
    ...report,
    agents: report.agents.map((agent) => ({
      ...agent,
      items: agent.items.map(({ text: _text, ...item }) => item),
    })),
  };
  return `${JSON.stringify({ ...slim, ...extra }, null, 2)}\n`;
}
