import type { AgentReport, Report } from '../core/types.ts';
import { formatUsd } from '../core/usage.ts';
import { tokenizerSentence } from './common.ts';

// Ways to share a result: a markdown summary for a pull request comment, an SVG summary card
// and an SVG README badge. All plain strings, no network, no dependencies.

const num = (n: number) => n.toLocaleString('en-US');
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const pct = (n: number) => (n === 0 ? '0%' : n < 0.1 ? '<0.1%' : `${n.toFixed(n < 10 ? 1 : 0)}%`);

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
  lines.push(
    '| Tool | Model | Startup tokens | % of window | Overhead cost | Dropped |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
  );
  for (const a of report.agents) {
    lines.push(
      `| ${cell(a.label)} | ${cell(a.model.label)}${a.model.isDefault ? '*' : ''} | ${num(a.startup.total)} | ${pct(a.usage.startupPctOfContext)} | ${formatUsd(a.usage.overheadCostUsd)} | ${willDrops(a) || '-'} |`,
    );
  }
  lines.push('');

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

  const checks = (report as { checks?: { message: string }[] }).checks ?? [];
  if (checks.length > 0) {
    lines.push('<details><summary>Checks</summary>', '');
    for (const c of checks.slice(0, 15)) lines.push(`- ${c.message}`);
    lines.push('', '</details>', '');
  }

  const anyDefault = report.agents.some((a) => a.model.isDefault);
  lines.push(
    `<sub>Overhead = startup tokens x ${report.messages} messages at the uncached input price. ` +
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

// ---------------------------------------------------------------- Card

export interface CardOptions {
  /** Shown in the card header; default "ctxsize report". */
  title?: string;
}

const CARD_W = 1200;
const ROW = 44;

/** A 1200px-wide SVG summary: one bar per tool, scaled to the largest startup load. */
export function renderCardSvg(report: Report, opts: CardOptions = {}): string {
  const title = opts.title ?? 'ctxsize report';
  const agents = report.agents;
  const max = Math.max(1, ...agents.map((a) => a.startup.total));
  const top = 150;
  const height = top + agents.length * ROW + 80;
  const labelW = 190;
  const barX = 40 + labelW;
  const barMax = CARD_W - barX - 330;
  const rows = agents
    .map((a, i) => {
      const y = top + i * ROW;
      const w = Math.max(2, Math.round((a.startup.total / max) * barMax));
      const cost =
        a.usage.overheadCostUsd === null ? '' : `  ${formatUsd(a.usage.overheadCostUsd)}`;
      return `<text x="40" y="${y + 24}" class="l">${esc(a.label)}</text>
<rect x="${barX}" y="${y + 6}" width="${w}" height="26" rx="5" class="bar"/>
<text x="${barX + w + 12}" y="${y + 25}" class="v">${num(a.startup.total)}</text>
<text x="${CARD_W - 40}" y="${y + 25}" class="s" text-anchor="end">${esc(pct(a.usage.startupPctOfContext))} of window${esc(cost)}</text>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${height}" viewBox="0 0 ${CARD_W} ${height}" role="img" aria-label="${esc(title)}: startup tokens per coding agent">
<style>
text{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;fill:#1a1918}
.t{font-size:34px;font-weight:700}.sub{font-size:18px;fill:#5e5d59}
.l{font-size:20px}.v{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}.s{font-size:16px;fill:#5e5d59}
.bar{fill:#2f6fed}
</style>
<rect width="${CARD_W}" height="${height}" fill="#fbfaf7"/>
<text x="40" y="64" class="t">${esc(title)}</text>
<text x="40" y="100" class="sub">Tokens each coding agent loads before the first prompt (${esc(tokenizerSentence(report).replace(/\.$/, ''))})</text>
${rows}
<text x="40" y="${height - 28}" class="s">Overhead cost = startup tokens x ${report.messages} messages at the uncached input price. Generated by ctxsize v${esc(report.tool.version)}</text>
</svg>
`;
}

// ---------------------------------------------------------------- Badge

/** The text on the badge: the heaviest startup load of any tool, e.g. "8.8k tokens". */
export function badgeText(report: Report): { label: string; value: string } {
  const worst = Math.max(0, ...report.agents.map((a) => a.startup.total));
  return { label: 'ctxsize', value: `${compactTokens(worst)} tokens` };
}

/** A flat two-part README badge as SVG. */
export function renderBadgeSvg(report: Report): string {
  const { label, value } = badgeText(report);
  const width = (s: string) => Math.round(s.length * 6.6) + 20;
  const lw = width(label);
  const vw = width(value);
  const total = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<rect width="${lw}" height="20" fill="#555"/>
<rect x="${lw}" width="${vw}" height="20" fill="#2f6fed"/>
<g fill="#fff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
<text x="${lw / 2}" y="14">${esc(label)}</text>
<text x="${lw + vw / 2}" y="14">${esc(value)}</text>
</g>
</svg>
`;
}

/** Markdown for a badge hosted by shields.io (a static badge: shields.io never sees your repo). */
export function badgeMarkdown(report: Report): string {
  const { label, value } = badgeText(report);
  const enc = (s: string) => encodeURIComponent(s).replaceAll('-', '--').replaceAll('_', '__');
  return `![${label}](https://img.shields.io/badge/${enc(label)}-${enc(value)}-2f6fed)`;
}
