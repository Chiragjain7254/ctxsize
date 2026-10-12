import type { Report } from '../core/types.ts';

/** Placeholder until the treemap milestone (docs/PLAN.md, M5). */
export function renderHtml(report: Report): string {
  return `<!doctype html><meta charset="utf-8"><title>ctxsize report</title><pre>${report.agents.length} agents</pre>\n`;
}
