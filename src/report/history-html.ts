import type { HistoryResult } from '../history.ts';

// A single self-contained page for `--history N --html`: a line chart of startup tokens per
// tool over the last N commits, plus the same numbers as a table. No scripts, no requests.

export interface HistoryHtmlOptions {
  /** Tool id -> label. */
  labels: Record<string, string>;
  version: string;
}

const W = 960;
const H = 420;
const PAD = { left: 64, right: 24, top: 20, bottom: 56 };
/** Ten distinguishable hues; tools past the fifth also get a dash pattern so colour is not the only cue. */
const COLORS = [
  '#2f6fed',
  '#d9480f',
  '#2b8a3e',
  '#9c36b5',
  '#e08a00',
  '#0b7285',
  '#c2255c',
  '#5f3dc4',
  '#495057',
  '#74b816',
];
const DASHES = ['', '', '', '', '', '6 4', '6 4', '6 4', '2 3', '2 3'];

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const num = (n: number) => n.toLocaleString('en-US');

/** A round upper bound for the y axis and about five tick values. */
export function niceAxis(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const rough = max / 5;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { top, ticks };
}

export function renderHistoryHtml(result: HistoryResult, opts: HistoryHtmlOptions): string {
  const entries = result.entries;
  const ids = [...new Set(entries.flatMap((e) => Object.keys(e.tools)))];
  const active = ids.filter((id) => entries.some((e) => (e.tools[id] ?? 0) > 0));
  const idle = ids.filter((id) => !active.includes(id));
  const max = Math.max(0, ...entries.flatMap((e) => active.map((id) => e.tools[id] ?? 0)));
  const axis = niceAxis(max);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (entries.length <= 1 ? plotW / 2 : (i / (entries.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / axis.top) * plotH;
  const label = (id: string) => opts.labels[id] ?? id;

  const grid = axis.ticks
    .map(
      (t) =>
        `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${PAD.left - 8}" y="${y(t) + 4}" text-anchor="end" class="axis">${num(t)}</text>`,
    )
    .join('');
  const xLabels = entries
    .map((e, i) => ({ e, i }))
    .filter(
      ({ i }) =>
        entries.length <= 12 ||
        i % Math.ceil(entries.length / 12) === 0 ||
        i === entries.length - 1,
    )
    .map(
      ({ e, i }) =>
        `<text x="${x(i)}" y="${H - PAD.bottom + 20}" text-anchor="middle" class="axis">${esc(e.commit.slice(0, 7))}</text>`,
    )
    .join('');
  const lines = active
    .map((id, k) => {
      const color = COLORS[k % COLORS.length];
      const dash = DASHES[k % DASHES.length];
      const points = entries
        .map((e, i) => `${x(i).toFixed(1)},${y(e.tools[id] ?? 0).toFixed(1)}`)
        .join(' ');
      const dots = entries
        .map(
          (e, i) =>
            `<circle cx="${x(i).toFixed(1)}" cy="${y(e.tools[id] ?? 0).toFixed(1)}" r="3.5" fill="${color}"><title>${esc(label(id))}: ${num(e.tools[id] ?? 0)} tokens at ${esc(e.commit.slice(0, 7))} (${esc(e.subject)})</title></circle>`,
        )
        .join('');
      return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.2"${dash ? ` stroke-dasharray="${dash}"` : ''}/>${dots}`;
    })
    .join('');
  const legend = active
    .map((id, k) => {
      const dash = DASHES[k % DASHES.length];
      return `<li><svg width="28" height="10" aria-hidden="true"><line x1="0" y1="5" x2="28" y2="5" stroke="${COLORS[k % COLORS.length]}" stroke-width="3"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>${esc(label(id))}</li>`;
    })
    .join('');
  const head = `<tr><th>Commit</th><th>Date</th>${active.map((id) => `<th class="r">${esc(label(id))}</th>`).join('')}</tr>`;
  const rows = [...entries]
    .reverse()
    .map(
      (e) =>
        `<tr><td><code>${esc(e.commit.slice(0, 7))}</code> ${esc(e.subject)}</td><td>${esc(e.date.slice(0, 10))}</td>${active.map((id) => `<td class="r">${num(e.tools[id] ?? 0)}</td>`).join('')}</tr>`,
    )
    .join('');
  const note = [
    result.shallow ? 'This is a shallow clone: older commits are not available.' : '',
    result.analyzed < result.requested && !result.shallow
      ? `Only ${result.analyzed} commit(s) exist on this branch.`
      : '',
    idle.length > 0 ? `No startup tokens in any commit for: ${idle.map(label).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ctxsize history</title>
<style>
:root{--bg:#fbfaf7;--ink:#1a1918;--ink2:#5e5d59;--line:#dcd9d0}
@media (prefers-color-scheme:dark){:root{--bg:#171717;--ink:#ecebe6;--ink2:#a8a69f;--line:#3a3935}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--ink2);margin:0 0 16px}
svg.chart{width:100%;height:auto;display:block}
.grid{stroke:var(--line);stroke-width:1}.axis{fill:var(--ink2);font-size:12px}
ul.legend{display:flex;flex-wrap:wrap;gap:6px 18px;list-style:none;padding:0;margin:8px 0 16px;color:var(--ink2)}
ul.legend li{display:flex;align-items:center;gap:6px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line)}th{color:var(--ink2)}.r{text-align:right;font-variant-numeric:tabular-nums}
.tw{overflow-x:auto}footer{margin-top:24px;color:var(--ink2);font-size:13px}
</style>
</head>
<body>
<main>
<h1>Startup tokens over the last ${entries.length} commit${entries.length === 1 ? '' : 's'}</h1>
<p class="sub">Tokens each tool loads before the first prompt, per commit, oldest to newest. Tokens are estimates. Only commits are analysed, not the working tree.${note ? ` ${esc(note)}` : ''}</p>
${
  active.length === 0
    ? '<p>No tool loaded any startup tokens in these commits.</p>'
    : `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart of startup tokens per tool by commit">${grid}${xLabels}${lines}</svg>
<ul class="legend">${legend}</ul>
<div class="tw"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`
}
<footer>Generated by ctxsize v${esc(opts.version)}.</footer>
</main>
</body>
</html>
`;
}
