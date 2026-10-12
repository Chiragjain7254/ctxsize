import type { AgentReport, Category, Report } from '../core/types.ts';
import { formatUsd } from '../core/usage.ts';
import { tokenizerSentence } from './common.ts';
import { toJson } from './json.ts';
import { squarify } from './treemap.ts';

// A single self-contained HTML file: inline CSS, inline SVG, a few lines of inline JS,
// no external URLs. Colors are the validated default categorical palette (light and
// dark steps); fills are tints so labels stay in text ink, and a table gives relief for
// the two light-mode slots under 3:1.

const W = 960;
const H = 520;
const GAP = 2;

const CATEGORY_LABEL: Record<Category, string> = {
  instructions: 'Instructions',
  rules: 'Rules',
  skills: 'Skills listing',
  memory: 'Memory',
};

interface Tile {
  path: string;
  category: Category;
  tokens: number;
  reason: string;
  dropped: 'no' | 'dropped' | 'cut';
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const num = (n: number) => n.toLocaleString('en-US');

function tilesFor(agent: AgentReport): Tile[] {
  const tiles: Tile[] = [];
  for (const item of agent.items) {
    const droppedWhole = item.load === 'ignored' && item.reason.includes('(dropped:');
    if (item.load !== 'startup' && !droppedWhole) continue;
    tiles.push({
      path: item.skill ? `skill: ${item.skill.name}` : item.path,
      category: item.category,
      tokens: item.tokens,
      reason: item.reason,
      dropped: droppedWhole ? 'dropped' : 'no',
    });
  }
  for (const drop of agent.drops) {
    if (drop.certainty !== 'will' || !drop.tokensLost) continue;
    if (drop.kind !== 'file-truncated' && drop.kind !== 'skill-description-truncated') continue;
    const item = agent.items.find((i) => i.path === drop.path);
    tiles.push({
      path: `${drop.skill ? `skill: ${drop.skill}` : (drop.path ?? '')} (cut part)`,
      category: item?.category ?? 'instructions',
      tokens: drop.tokensLost,
      reason: `cut by ${drop.limit}`,
      dropped: 'cut',
    });
  }
  return tiles;
}

function treemapSvg(agent: AgentReport): string {
  const tiles = tilesFor(agent);
  if (tiles.length === 0) {
    return '<p class="empty">Nothing from this repo loads at startup for this agent.</p>';
  }
  const placed = squarify(tiles, (t) => t.tokens, { x: 0, y: 0, w: W, h: H });
  const total = tiles.reduce((s, t) => s + t.tokens, 0);
  const rects = placed.map((p) => {
    const t = p.datum;
    const x = p.x + GAP / 2;
    const y = p.y + GAP / 2;
    const w = Math.max(0, p.w - GAP);
    const h = Math.max(0, p.h - GAP);
    const pct = ((t.tokens / total) * 100).toFixed(1);
    const status = t.dropped === 'no' ? '' : t.dropped === 'cut' ? 'Cut off (lost)' : 'Dropped';
    const tip = [
      t.path,
      `${num(t.tokens)} tokens · ${pct}%`,
      CATEGORY_LABEL[t.category],
      t.reason,
      status,
    ]
      .filter(Boolean)
      .join('\n');
    const name = t.path.split('/').pop() ?? t.path;
    const maxChars = Math.floor((w - 12) / 7);
    const label = name.length > maxChars ? `${name.slice(0, Math.max(0, maxChars - 1))}…` : name;
    const showLabel = w >= 56 && h >= 34 && maxChars >= 4;
    const showDir = showLabel && h >= 52 && t.path.includes('/');
    const dir = t.path.slice(0, t.path.lastIndexOf('/'));
    const dirLabel = dir.length > maxChars ? `…${dir.slice(dir.length - maxChars + 1)}` : dir;
    return [
      `<g class="tile cat-${t.category}${t.dropped !== 'no' ? ' lost' : ''}" tabindex="0" data-tip="${esc(tip)}">`,
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3"/>`,
      w >= 6 && h >= 4
        ? `<rect class="strip" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.min(4, h).toFixed(1)}" rx="2"/>`
        : '',
      showLabel
        ? `<text x="${(x + 8).toFixed(1)}" y="${(y + 21).toFixed(1)}"><tspan class="n">${esc(label)}</tspan><tspan class="v" x="${(x + 8).toFixed(1)}" dy="15">${num(t.tokens)}${t.dropped !== 'no' ? (t.dropped === 'cut' ? ' cut' : ' dropped') : ''}</tspan></text>`
        : '',
      showDir
        ? `<text class="d" x="${(x + 8).toFixed(1)}" y="${(y + h - 8).toFixed(1)}">${esc(dirLabel)}</text>`
        : '',
      '</g>',
    ].join('');
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(agent.label)} startup tokens by file">${rects.join('')}</svg>`;
}

function legend(agent: AgentReport): string {
  const tiles = tilesFor(agent);
  const cats = (['instructions', 'rules', 'skills', 'memory'] as const).filter((c) =>
    tiles.some((t) => t.category === c),
  );
  const items = cats.map(
    (c) => `<span class="key"><i class="sw cat-${c}"></i>${CATEGORY_LABEL[c]}</span>`,
  );
  if (tiles.some((t) => t.dropped !== 'no')) {
    items.push('<span class="key"><i class="sw lost-sw"></i>Dropped or cut off</span>');
  }
  return items.length > 1 || tiles.some((t) => t.dropped !== 'no')
    ? `<div class="legend">${items.join('')}</div>`
    : '';
}

function itemTable(agent: AgentReport): string {
  const rows = [...agent.items]
    .sort((a, b) => b.tokens - a.tokens)
    .map(
      (i) =>
        `<tr><td class="p">${esc(i.skill ? `${i.path} (${i.skill.name})` : i.path)}</td><td>${CATEGORY_LABEL[i.category]}</td><td>${i.load}</td><td class="r">${num(i.tokens)}</td><td>${esc(i.reason)}</td></tr>`,
    );
  if (rows.length === 0) return '';
  return `<details><summary>All ${agent.items.length} files as a table</summary><div class="tw"><table><thead><tr><th>File</th><th>Category</th><th>Loads</th><th class="r">Tokens</th><th>Why</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></details>`;
}

function findings(agent: AgentReport): string {
  const parts: string[] = [];
  const will = agent.drops.filter((d) => d.certainty === 'will');
  if (will.length > 0) {
    parts.push(
      `<li class="bad"><b>✗ ${will.length} dropped or cut</b>: ${will
        .slice(0, 6)
        .map((d) => esc(d.skill ?? d.path ?? ''))
        .join(', ')}${will.length > 6 ? ` and ${will.length - 6} more` : ''}</li>`,
    );
  }
  for (const note of agent.notes) parts.push(`<li>${esc(note)}</li>`);
  for (const w of agent.warnings.slice(0, 5)) {
    parts.push(`<li class="warn">! ${esc(w.path ? `${w.path}: ` : '')}${esc(w.message)}</li>`);
  }
  if (agent.warnings.length > 5)
    parts.push(`<li class="warn">! ${agent.warnings.length - 5} more warnings in --json</li>`);
  return parts.length ? `<ul class="findings">${parts.join('')}</ul>` : '';
}

export function renderHtml(report: Report): string {
  const agents = report.agents;
  const tabs = agents
    .map(
      (a, i) =>
        `<button role="tab" id="tab-${a.agent}" aria-controls="panel-${a.agent}" aria-selected="${i === 0}"${i === 0 ? '' : ' tabindex="-1"'}><span class="tl">${esc(a.label)}</span><span class="tv">${num(a.startup.total)}</span>${a.drops.some((d) => d.certainty === 'will') ? '<span class="tb" title="drops files">✗</span>' : ''}</button>`,
    )
    .join('');
  const panels = agents
    .map(
      (a, i) =>
        `<section role="tabpanel" id="panel-${a.agent}" aria-labelledby="tab-${a.agent}"${i === 0 ? '' : ' hidden'}>
<p class="stat"><b>${num(a.startup.total)}</b> tokens at startup · ${num(a.onDemand.total)} more on demand (${a.onDemand.count} files) · ${((a.startup.total / a.contextTokens) * 100).toFixed(1)}% of a ${num(a.contextTokens)}-token window</p>
${legend(a)}
<div class="map">${treemapSvg(a)}</div>
${findings(a)}
${itemTable(a)}
</section>`,
    )
    .join('\n');
  const data = toJson(report).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ctxsize report</title>
<style>
:root{color-scheme:light;--bg:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--ink3:#7a7974;--line:#e4e3df;--chip:#f0efec;
--c1:#2a78d6;--c2:#eb6834;--c3:#1baf7a;--c4:#eda100;--bad:#d03b3b;--warn:#a86b00;--tint:22%}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--ink3:#8f8e88;--line:#383835;--chip:#262624;
--c1:#3987e5;--c2:#d95926;--c3:#199e70;--c4:#c98500;--bad:#e66767;--warn:#fab219;--tint:30%}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--ink3:#8f8e88;--line:#383835;--chip:#262624;
--c1:#3987e5;--c2:#d95926;--c3:#199e70;--c4:#c98500;--bad:#e66767;--warn:#fab219;--tint:30%}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:28px 16px 48px}
h1{font-size:22px;margin:0}
.sub{color:var(--ink2);margin:4px 0 20px}
[role=tablist]{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}
[role=tab]{font:inherit;color:var(--ink2);background:var(--chip);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer;display:flex;gap:8px;align-items:baseline}
[role=tab][aria-selected=true]{color:var(--ink);border-color:var(--ink2);background:var(--bg)}
[role=tab]:focus-visible,.tile:focus-visible{outline:2px solid var(--c1);outline-offset:2px}
.tv{font-variant-numeric:tabular-nums;font-weight:600;color:var(--ink)}
.tb{color:var(--bad);font-weight:700}
.stat{margin:0 0 10px;color:var(--ink2)}.stat b{color:var(--ink);font-size:20px}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin:0 0 10px;color:var(--ink2);font-size:13px}
.key{display:inline-flex;align-items:center;gap:6px}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block;background:var(--c)}
.map svg{width:100%;height:auto;display:block}
.tile rect{fill:color-mix(in srgb,var(--c) var(--tint),var(--bg))}
.tile .strip{fill:var(--c)}
.tile.lost rect{fill:url(#hatch)}
.tile.lost .strip{fill:var(--bad)}
.tile:hover rect:first-child{fill:color-mix(in srgb,var(--c) calc(var(--tint) + 14%),var(--bg))}
.tile text{fill:var(--ink);font-size:12px;pointer-events:none}
.tile .n{font-weight:600}.tile .v{fill:var(--ink2);font-variant-numeric:tabular-nums}.tile .d{fill:var(--ink3);font-size:11px}
.cat-instructions{--c:var(--c1)}.cat-rules{--c:var(--c2)}.cat-skills{--c:var(--c3)}.cat-memory{--c:var(--c4)}
.lost-sw{background:repeating-linear-gradient(45deg,var(--bad) 0 2px,transparent 2px 5px);border:1px solid var(--bad)}
.empty{padding:40px;text-align:center;color:var(--ink2);border:1px dashed var(--line);border-radius:8px}
.findings{margin:14px 0;padding-left:18px;color:var(--ink2)}.findings li{margin:3px 0}
.findings .bad b{color:var(--bad)}.findings .warn{color:var(--warn);list-style:none;margin-left:-14px}
details{margin-top:12px}summary{cursor:pointer;color:var(--ink2)}
.tw{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--ink2);font-weight:600}.r{text-align:right;font-variant-numeric:tabular-nums}.p{word-break:break-all}
#tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--bg);font-size:12px;line-height:1.45;padding:7px 10px;border-radius:6px;white-space:pre-line;max-width:340px;display:none;z-index:2}
footer{margin-top:28px;color:var(--ink3);font-size:13px}
@media (forced-colors:active){.tile rect{fill:Canvas;stroke:CanvasText}}
</style>
</head>
<body>
<main>
<h1>What each agent loads before your first prompt</h1>
<p class="sub">Tokens per file. ${esc(tokenizerSentence(report))} Only your files; agents' own system prompts and tools are not included.</p>
<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--bg)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--bad)" stroke-width="2"/></pattern></defs></svg>
${comparisonTable(report)}
<div role="tablist" aria-label="Agents">${tabs}</div>
${panels}
<footer>Generated by ctxsize v${esc(report.tool.version)}. Limits come from each agent's documentation; see the project README for sources.</footer>
</main>
<div id="tip" role="tooltip"></div>
<script type="application/json" id="ctxsize-data">${data}</script>
<script>
(()=>{const tabs=[...document.querySelectorAll('[role=tab]')];
const show=t=>{for(const x of tabs){const on=x===t;x.setAttribute('aria-selected',on);x.tabIndex=on?0:-1;document.getElementById(x.getAttribute('aria-controls')).hidden=!on}t.focus()};
tabs.forEach((t,i)=>{t.onclick=()=>show(t);t.onkeydown=e=>{const d=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(d)show(tabs[(i+d+tabs.length)%tabs.length])}});
const tip=document.getElementById('tip');
const place=(e,el)=>{tip.textContent=el.dataset.tip;tip.style.display='block';const r=tip.getBoundingClientRect();let x=e.clientX+14,y=e.clientY+14;if(x+r.width>innerWidth-8)x=e.clientX-r.width-14;if(y+r.height>innerHeight-8)y=e.clientY-r.height-14;tip.style.left=Math.max(8,x)+'px';tip.style.top=Math.max(8,y)+'px'};
for(const el of document.querySelectorAll('.tile')){el.onmousemove=e=>place(e,el);el.onmouseleave=()=>tip.style.display='none';
el.onfocus=()=>{const b=el.getBoundingClientRect();place({clientX:b.left+8,clientY:b.top+8},el)};el.onblur=()=>tip.style.display='none'}})();
</script>
</body>
</html>
`;
}

/** All tools side by side: model, startup load, share of the window, and what it costs. */
function comparisonTable(report: Report): string {
  const rows = report.agents
    .map(
      (a) =>
        `<tr><td>${esc(a.label)}</td><td>${esc(a.model.label)}${a.model.isDefault ? ' <span title="default model; choose one with --model">*</span>' : ''}</td><td class="r">${num(a.startup.total)}</td><td class="r">${a.usage.startupPctOfContext}%</td><td class="r">${num(a.usage.overheadTokens)}</td><td class="r">${formatUsd(a.usage.overheadCostUsd)}</td></tr>`,
    )
    .join('');
  return `<div class="tw"><table><caption class="sub">Cost of carrying the startup load for ${num(report.messages)} messages, at each model's uncached input price (prompt caching lowers it).</caption><thead><tr><th>Agent</th><th>Model</th><th class="r">Startup tokens</th><th class="r">% of window</th><th class="r">Overhead tokens</th><th class="r">Cost</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
