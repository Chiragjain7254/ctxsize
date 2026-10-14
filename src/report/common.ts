import type { Report } from '../core/types.ts';

/** "o200k_base" or "o200k_base, ~3.5 chars per token": every tokenizer used in a report. */
export function tokenizerSummary(report: Report): string {
  return [...new Set(report.agents.map((a) => a.model.tokenizer))].join(', ');
}

/** "Tokens are estimates (...)" unless every model's tokenizer is its own. */
export function tokenizerSentence(report: Report): string {
  if (report.agents.length === 0) return 'Tokens are estimates.';
  const exact = report.agents.every((a) => a.model.exactTokenizer);
  return exact
    ? `Tokens counted with ${tokenizerSummary(report)}.`
    : `Tokens are estimates (${tokenizerSummary(report)}); a ~ marks an estimated count.`;
}

/** "Hidden: Aider, Zed (no files found) — use --all to show", or undefined when nothing is hidden. */
export function hiddenSentence(report: Report): string | undefined {
  const hidden = report.hidden ?? [];
  if (hidden.length === 0) return undefined;
  return `Hidden: ${hidden.map((h) => h.label).join(', ')} (no files found) — use --all to show`;
}
