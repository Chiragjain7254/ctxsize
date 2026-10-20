import { describePrice } from '../core/price.ts';
import type { AgentReport, Report } from '../core/types.ts';
import { gradeColor } from './card.ts';
import { hiddenSentence, tokenizerSentence } from './common.ts';
import { fmt } from './format.ts';
import { reportGrades } from './summary.ts';

// Ways to share a result: a markdown summary for a pull request comment, an SVG summary card
// and an SVG README badge. All plain strings, no network, no dependencies.

const num = (n: number) => n.toLocaleString('en-US');
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const pct = (n: number | null) => (n === null ? 'unknown' : fmt.pct(n));

/** 8819 -> "8.8k", 950 -> "950". */
export function compactTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
}

function willDrops(a: AgentReport): number {
  return a.drops.filter((d) => d.certainty === 'will').length;
}

// ---------------------------------------------------------------- Markdown

/** A summary for a pull request comment. File contents are never included. */
export function renderMarkdown(report: Report): string {
  const lines: string[] = ['### ctxsize: what each agent loads before the first prompt', ''];
  const grades = reportGrades(report);
  if (grades.overall) {
    lines.push(`**Context health: ${grades.overall.letter}** (${grades.overall.score}/100)`, '');
  }
  // The cost column exists only when the user gave a price (--price): ctxsize has none of its own.
  const price = report.price;
  lines.push(
    `| Tool | Model | Startup tokens | % of window |${price ? ' Overhead cost |' : ''} Dropped | Grade |`,
    `| --- | --- | ---: | ---: |${price ? ' ---: |' : ''} ---: | :---: |`,
  );
  for (const a of report.agents) {
    const cost = price ? ` ${fmt.money(a.usage.overheadCost, price.currency)} |` : '';
    lines.push(
      `| ${cell(a.label)} | ${cell(a.model.label)}${a.model.isDefault ? '*' : ''} | ${num(a.startup.total)} | ${pct(a.usage.startupPctOfContext)} |${cost} ${willDrops(a) || '-'} | ${grades.agents[a.agent]?.letter ?? '-'} |`,
    );
  }
  lines.push('');
  const hidden = hiddenSentence(report);
  if (hidden) lines.push(`_${hidden}_`, '');

  const files = new Map<string, number>();
  for (const a of report.agents) {
    for (const f of a.topFiles) {
      const key = f.skill ? `skill: ${f.skill}` : f.path;
      files.set(key, Math.max(files.get(key) ?? 0, f.tokens));
    }
  }
  const top = [...files].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5);
  if (top.length > 0) {
    lines.push(`**Biggest files:** ${top.map(([p, t]) => `\`${p}\` ${num(t)}`).join(', ')}`, '');
  }

  const dropped = report.agents.filter((a) => willDrops(a) > 0);
  if (dropped.length > 0) {
    lines.push('<details><summary>Dropped content</summary>', '');
    for (const a of dropped) {
      for (const d of a.drops.filter((x) => x.certainty === 'will').slice(0, 10)) {
        lines.push(
          `- ${cell(a.label)}: ${d.kind.replaceAll('-', ' ')} \`${d.skill ?? d.path ?? ''}\``,
        );
      }
    }
    lines.push('', '</details>', '');
  }

  const checks = report.checks;
  if (checks.length > 0) {
    lines.push('<details><summary>Checks</summary>', '');
    for (const c of checks.slice(0, 15)) lines.push(`- ${c.message}`);
    lines.push('', '</details>', '');
  }

  const anyDefault = report.agents.some((a) => a.model.isDefault);
  lines.push(
    `<sub>${
      report.price
        ? `Overhead cost = startup tokens x ${report.messages} messages at ${describePrice(report.price, fmt.withCurrency)} (uncached). `
        : 'Add --price 3 --per 1m to see cost. '
    }` +
      `${tokenizerSentence(report)}${anyDefault ? ' * assumed default model.' : ''} ` +
      `ctxsize v${report.tool.version}</sub>`,
    '',
  );
  return lines.join('\n');
}

/** Pipes and line breaks would break a markdown table row. */
function cell(text: string): string {
  return text.replaceAll('|', '\\|').replace(/\s+/g, ' ');
}

export { type CardOptions, renderCardPng, renderCardSvg } from './card.ts';

// ---------------------------------------------------------------- Badge

/** The text on the badge: the overall grade and the heaviest startup load, e.g. "B · 8.8k tokens". */
export function badgeText(report: Report): { label: string; value: string; color: string } {
  const worst = Math.max(0, ...report.agents.map((a) => a.startup.total));
  const grade = reportGrades(report).overall?.letter;
  const tokens = `${compactTokens(worst)} tokens`;
  return {
    label: 'ctxsize',
    value: grade ? `${grade} · ${tokens}` : tokens,
    color: gradeColor(grade ?? '-').replace('#', ''),
  };
}

/** A flat two-part README badge as SVG. */
export function renderBadgeSvg(report: Report): string {
  const { label, value, color } = badgeText(report);
  const width = (s: string) => Math.round(s.length * 6.6) + 20;
  const lw = width(label);
  const vw = width(value);
  const total = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<rect width="${lw}" height="20" fill="#555"/>
<rect x="${lw}" width="${vw}" height="20" fill="#${color}"/>
<g fill="#fff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
<text x="${lw / 2}" y="14">${esc(label)}</text>
<text x="${lw + vw / 2}" y="14">${esc(value)}</text>
</g>
</svg>
`;
}

/**
 * Markdown for a badge hosted by shields.io (a static badge: shields.io never sees your repo),
 * linking back to ctxsize so a reader can try it on their own repo.
 */
export function badgeMarkdown(report: Report): string {
  const { label, value, color } = badgeText(report);
  const enc = (s: string) => encodeURIComponent(s).replaceAll('-', '--').replaceAll('_', '__');
  const alt = `${label}: ${value}`;
  return `[![${alt}](https://img.shields.io/badge/${enc(label)}-${enc(value)}-${color})](https://github.com/Chiragjain7254/ctxsize)`;
}
