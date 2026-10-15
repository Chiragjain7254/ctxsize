import { countTokens, type Tokenizer, tokenizerLabel } from '../core/tokenize.ts';
import type { AgentReport, Category, LoadedItem, ModelInfo, Report } from '../core/types.ts';
import { allModels, type Model } from '../models.ts';
import { type CalcAgent, type CalcItem, type CalcModel, createCalc } from './calc.ts';
import { hiddenSentence } from './common.ts';
import { pageMain } from './page-client.ts';
import { renderCardSvg, renderMarkdown } from './share.ts';
import { squarify } from './treemap.ts';

// One self-contained interactive file: inline CSS, inline JS, the data embedded as JSON, no
// external URLs and no requests. The page recounts tokens for another model's tokenizer from
// the per-item counts embedded here (o200k_base and cl100k_base) and the item's character
// count (for chars-per-token models). Colors are the validated default categorical palette;
// fills are tints so labels stay in text ink, and a table gives relief for the two
// light-mode slots under 3:1.

export interface HtmlOptions {
  /** Models offered in the dropdowns; default: the presets. Models the report used are always added. */
  models?: Map<string, Model>;
  /** Watch mode: the page polls this sibling script file for new data. */
  watch?: { file: string; everyMs?: number };
  /** --serve: the page listens to this Server-Sent Events URL for new data. */
  stream?: string;
  /** Changes on every rewrite in watch mode, so the page knows data is new. */
  generated?: string;
}

interface PageModel extends CalcModel {
  tokLabel: string;
  exact: boolean;
}

interface PageItem extends CalcItem {
  path: string;
  skill?: string;
  reason: string;
}

interface PageAgent extends CalcAgent {
  id: string;
  label: string;
  hasDrops: boolean;
  items: PageItem[];
  cuts: { of: string; name: string; category: Category; tokens: number; limit: string }[];
  findings: { cls: 'bad' | 'warn' | ''; head: string; text: string }[];
}

export interface PageData {
  version: string;
  messages: number;
  generated: string | null;
  watch: { file: string; every: number } | null;
  stream: string | null;
  models: PageModel[];
  agents: PageAgent[];
}

function pageModel(m: Model): PageModel {
  const ratio = typeof m.tokenizer === 'object' ? m.tokenizer.charsPerToken : undefined;
  return {
    id: m.id,
    label: m.label,
    tok: ratio === undefined ? (m.tokenizer as 'o200k_base' | 'cl100k_base') : 'ratio',
    ...(ratio === undefined ? {} : { ratio }),
    tokLabel: tokenizerLabel(m.tokenizer as Tokenizer),
    exact: m.exactTokenizer,
    window: m.contextTokens,
    price: m.pricePer1MInput ?? null,
  };
}

/** A model the report used that is not in the list (a CLI --price changes only the price). */
function fromInfo(info: ModelInfo): PageModel {
  const ratio = /^~([\d.]+) chars per token$/.exec(info.tokenizer)?.[1];
  return {
    id: info.id,
    label: info.label,
    tok: ratio ? 'ratio' : info.tokenizer === 'cl100k_base' ? 'cl100k_base' : 'o200k_base',
    ...(ratio ? { ratio: Number(ratio) } : {}),
    tokLabel: info.tokenizer,
    exact: info.exactTokenizer,
    window: info.contextTokens,
    price: info.pricePer1MInput,
  };
}

function itemKey(item: LoadedItem): string {
  return item.skill ? `${item.path}#${item.skill.name}` : item.path;
}

function findings(agent: AgentReport): PageAgent['findings'] {
  const out: PageAgent['findings'] = [];
  const will = agent.drops.filter((d) => d.certainty === 'will');
  if (will.length > 0) {
    out.push({
      cls: 'bad',
      head: `✗ ${will.length} dropped or cut`,
      text: `: ${will
        .slice(0, 6)
        .map((d) => d.skill ?? d.path ?? '')
        .join(', ')}${will.length > 6 ? ` and ${will.length - 6} more` : ''}`,
    });
  }
  for (const note of agent.notes) out.push({ cls: '', head: '', text: note });
  for (const w of agent.warnings.slice(0, 5)) {
    out.push({ cls: 'warn', head: '', text: `! ${w.path ? `${w.path}: ` : ''}${w.message}` });
  }
  if (agent.warnings.length > 5) {
    out.push({
      cls: 'warn',
      head: '',
      text: `! ${agent.warnings.length - 5} more warnings in --json`,
    });
  }
  return out;
}

function pageAgent(agent: AgentReport): PageAgent {
  const seen = new Set<string>();
  const items = agent.items.map((item): PageItem => {
    let key = itemKey(item);
    while (seen.has(key)) key += '+';
    seen.add(key);
    return {
      key,
      path: item.path,
      ...(item.skill ? { skill: item.skill.name } : {}),
      category: item.category,
      load: item.load,
      dropped: item.load === 'ignored' && item.reason.includes('(dropped:'),
      reason: item.reason,
      chars: [...item.text].length,
      o: countTokens(item.text, 'o200k_base'),
      c: countTokens(item.text, 'cl100k_base'),
    };
  });
  const cuts: PageAgent['cuts'] = [];
  for (const drop of agent.drops) {
    if (drop.certainty !== 'will' || !drop.tokensLost) continue;
    if (drop.kind !== 'file-truncated' && drop.kind !== 'skill-description-truncated') continue;
    const index = agent.items.findIndex(
      (i) => i.path === drop.path && (!drop.skill || i.skill?.name === drop.skill),
    );
    cuts.push({
      of: items[index]?.key ?? '',
      name: drop.skill ? `skill: ${drop.skill}` : (drop.path ?? ''),
      category: agent.items[index]?.category ?? 'instructions',
      tokens: drop.tokensLost,
      limit: drop.limit,
    });
  }
  return {
    id: agent.agent,
    label: agent.label,
    model: agent.model.id,
    window: agent.contextTokens,
    price: agent.model.pricePer1MInput,
    hasDrops: agent.drops.some((d) => d.certainty === 'will'),
    items,
    cuts,
    findings: findings(agent),
  };
}

/** Everything the page needs. Item texts are not included, only their sizes. */
export function buildPageData(report: Report, opts: HtmlOptions = {}): PageData {
  const byId = new Map<string, PageModel>();
  for (const m of (opts.models ?? allModels()).values()) byId.set(m.id, pageModel(m));
  for (const a of report.agents) if (!byId.has(a.model.id)) byId.set(a.model.id, fromInfo(a.model));
  return {
    version: report.tool.version,
    messages: report.messages,
    generated: opts.generated ?? null,
    watch: opts.watch ? { file: opts.watch.file, every: opts.watch.everyMs ?? 2000 } : null,
    stream: opts.stream ?? null,
    models: [...byId.values()],
    agents: report.agents.map(pageAgent),
  };
}

const json = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

/** The sibling file the page polls in watch mode. */
export function renderDataJs(report: Report, opts: HtmlOptions = {}): string {
  return `window.__ctxsizeData = ${json(buildPageData(report, opts))};\n`;
}

/** The page script: calc, squarify and the UI, copied from this package's own source. */
export function pageScript(): string {
  return `(function(){
var createCalc=${createCalc.toString()};
var squarify=${squarify.toString()};
var pageMain=${pageMain.toString()};
pageMain(createCalc(), squarify, document, window);
})();`;
}

export function renderHtml(report: Report, opts: HtmlOptions = {}): string {
  const data = buildPageData(report, opts);
  const noscript = report.agents
    .map(
      (a) =>
        `<li>${esc(a.label)}: ${a.model.exactTokenizer ? '' : '~'}${a.startup.total.toLocaleString('en-US')} tokens at startup (${a.usage.startupPctOfContext}% of the window)</li>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ctxsize report</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header class="top">
<h1>What each agent loads before your first prompt</h1>
<span id="live" class="live" hidden><span class="dot" aria-hidden="true"></span><span id="live-text"></span></span>
<button type="button" id="theme" class="btn" data-act="theme" aria-pressed="false" title="Switch between light and dark">Light / dark</button>
</header>
<p class="sub">Token counts are estimates. A ~ marks a count for a model whose tokenizer is not public (Claude, Gemini and others), made with o200k_base or a characters-per-token ratio; only OpenAI models are counted with their own tokenizer. Only your files; agents' own system prompts and tools are not included.</p>
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
<noscript><p class="empty">This report needs JavaScript. Startup tokens:</p><ul>${noscript}</ul></noscript>
${hiddenNote(report)}<section class="controls" aria-label="Controls">
<div class="grp"><h2>Tools <small>drag to rank, or use the arrows</small></h2><ul id="tools" class="tools"></ul></div>
<div class="grp fields">
<label>Context window <input id="in-ctx" inputmode="numeric" placeholder="model's own" aria-invalid="false"></label>
<label>Messages <input id="in-msgs" inputmode="numeric" aria-invalid="false"></label>
<label>Price, USD per 1M tokens <input id="in-price" inputmode="decimal" placeholder="model's own" aria-invalid="false"></label>
<label>Search files <input id="in-q" type="search" placeholder="path contains..."></label>
<button type="button" class="btn" data-act="reset">Reset</button>
</div>
</section>
<div id="notes" aria-live="polite"></div>
<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--bg)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--bad)" stroke-width="2"/></pattern></defs></svg>
<div id="compare"></div>
<div role="tablist" aria-label="Agents" id="tabs"></div>
<section role="tabpanel" id="panel"></section>
${extrasHtml(report)}
<footer>Generated by ctxsize v${esc(report.tool.version)}. Limits come from each agent's documentation; see the project README for sources. Everything on this page runs offline.</footer>
</main>
<div id="tip" role="tooltip"></div>
<script type="application/json" id="ctxsize-data">${json(data)}</script>
${shareData(report)}
<script>${SHARE_SCRIPT}</script>
<script>
${pageScript()}
</script>
</body>
</html>
`;
}

function hiddenNote(report: Report): string {
  const sentence = hiddenSentence(report);
  if (!sentence) return '';
  const hint = report.agents.length === 0 ? 'No agent loads any files from this repo. ' : '';
  return `<p class="sub" id="hidden">${esc(hint + sentence.replace('use --all to show', 'run with --all to show'))}</p>
`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const num = (n: number) => n.toLocaleString('en-US');

const CSS = `
:root{color-scheme:light;--bg:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--ink3:#7a7974;--line:#e4e3df;--chip:#f0efec;
--c1:#2a78d6;--c2:#eb6834;--c3:#1baf7a;--c4:#eda100;--bad:#d03b3b;--warn:#a86b00;--tint:22%}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--ink3:#8f8e88;--line:#383835;--chip:#262624;
--c1:#3987e5;--c2:#d95926;--c3:#199e70;--c4:#c98500;--bad:#e66767;--warn:#fab219;--tint:30%}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--ink3:#8f8e88;--line:#383835;--chip:#262624;
--c1:#3987e5;--c2:#d95926;--c3:#199e70;--c4:#c98500;--bad:#e66767;--warn:#fab219;--tint:30%}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:28px 16px 48px}
h1{font-size:22px;margin:0;flex:1}h2{font-size:14px;margin:0 0 6px}h2 small{color:var(--ink3);font-weight:400}
.top{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.sub{color:var(--ink2);margin:4px 0 16px}
.live{color:var(--c3);font-size:13px;display:inline-flex;align-items:center;gap:6px}.live[hidden]{display:none}
.live .dot{width:8px;height:8px;border-radius:50%;background:currentColor}.live.off{color:var(--bad)}
.toast{position:fixed;right:16px;bottom:16px;max-width:min(360px,calc(100vw - 32px));background:var(--ink);color:var(--bg);padding:10px 14px;border-radius:8px;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.25)}.toast[hidden]{display:none}
.btn,.sortb,.mv{font:inherit;color:var(--ink);background:var(--chip);border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer}
.btn:hover,.mv:hover:not(:disabled){border-color:var(--ink2)}.mv{padding:0 6px;font-size:11px}.mv:disabled{opacity:.35;cursor:default}
.sortb{background:none;border:0;padding:0;font-weight:600;color:var(--ink2)}
button:focus-visible,input:focus-visible,select:focus-visible,.tile:focus-visible,summary:focus-visible{outline:2px solid var(--c1);outline-offset:2px}
.controls{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px;border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:14px}
@media (max-width:760px){.controls{grid-template-columns:1fr}}
.tools{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.tools li{display:flex;gap:6px;align-items:center;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--chip);cursor:grab}
.tools li.dragging{opacity:.4}.tools li.over{border-color:var(--c1);box-shadow:0 0 0 1px var(--c1)}
.grip{color:var(--ink3);letter-spacing:-2px;user-select:none}.tl{flex:1;min-width:0}
.tools select{font:inherit;font-size:13px;max-width:180px;min-width:0;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:4px}
.fields{display:grid;gap:6px;align-content:start}
.fields label{display:grid;gap:2px;font-size:13px;color:var(--ink2)}
.fields input{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:3px 6px}
.fields input[aria-invalid=true]{border-color:var(--bad)}
.recheck{margin:0 0 12px;padding:8px 12px 8px 28px;border:1px solid var(--warn);border-radius:8px;color:var(--ink2);font-size:13px}
[role=tablist]{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0}
[role=tab]{font:inherit;color:var(--ink2);background:var(--chip);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer;display:flex;gap:8px;align-items:baseline}
[role=tab][aria-selected=true]{color:var(--ink);border-color:var(--ink2);background:var(--bg)}
.tv{font-variant-numeric:tabular-nums;font-weight:600;color:var(--ink)}
.tb{color:var(--bad);font-weight:700}.chg{color:var(--warn);font-size:12px}
.stat{margin:0 0 10px;color:var(--ink2)}.stat b{color:var(--ink);font-size:20px}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin:0 0 10px;color:var(--ink2);font-size:13px}
.key{display:inline-flex;align-items:center;gap:6px}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block;background:var(--c)}
.map svg{width:100%;height:auto;display:block}
.tile rect{fill:color-mix(in srgb,var(--c) var(--tint),var(--bg))}
.tile .strip{fill:var(--c)}
.tile.lost rect{fill:url(#hatch)}
.tile.lost .strip{fill:var(--bad)}
.tile.dim{opacity:.25}
.tile:hover rect:first-child{fill:color-mix(in srgb,var(--c) calc(var(--tint) + 14%),var(--bg))}
.tile text{fill:var(--ink);font-size:12px;pointer-events:none}
.tile .n{font-weight:600}.tile .v{fill:var(--ink2);font-variant-numeric:tabular-nums}.tile .d{fill:var(--ink3);font-size:11px}
.cat-instructions{--c:var(--c1)}.cat-rules{--c:var(--c2)}.cat-skills{--c:var(--c3)}.cat-memory{--c:var(--c4)}
.lost-sw{background:repeating-linear-gradient(45deg,var(--bad) 0 2px,transparent 2px 5px);border:1px solid var(--bad)}
.empty{padding:40px;text-align:center;color:var(--ink2);border:1px dashed var(--line);border-radius:8px}
.findings{margin:14px 0;padding-left:18px;color:var(--ink2)}.findings li{margin:3px 0}
.findings .bad b{color:var(--bad)}.findings .warn{color:var(--warn);list-style:none;margin-left:-14px}
.extra{margin-top:16px}.share{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--ink2)}#share-status{color:var(--ink2);font-size:13px}
details{margin-top:12px}summary{cursor:pointer;color:var(--ink2)}
.tw{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}
caption{text-align:left}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--ink2);font-weight:600}.r{text-align:right;font-variant-numeric:tabular-nums}th.r .sortb{text-align:right}.p{word-break:break-all}
.tk{width:28px;padding-right:0}.offrow td{color:var(--ink3);text-decoration:line-through}.offrow td.tk{text-decoration:none}
tr[data-act=tab]{cursor:pointer}tr.cur td{background:var(--chip)}
.vh{position:absolute;left:-9999px}
#tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--bg);font-size:12px;line-height:1.45;padding:7px 10px;border-radius:6px;white-space:pre-line;max-width:340px;display:none;z-index:2}
footer{margin-top:28px;color:var(--ink3);font-size:13px}
@media (forced-colors:active){.tile rect{fill:Canvas;stroke:CanvasText}}
`;

// ---------------------------------------------------------------- Sections that show the run as it was

const plain = (text: string) => text.replace(/<\/(script)/gi, '<\\/$1');

/** The card and markdown summary, embedded for the share buttons. */
function shareData(report: Report): string {
  return `<script type="text/plain" id="share-card">${plain(renderCardSvg(report).replace(' xmlns="http://www.w3.org/2000/svg"', ''))}</script>
<script type="text/plain" id="share-md">${plain(renderMarkdown(report))}</script>`;
}

/** Checks, folders, MCP servers and share buttons: fixed to the run, not to the what-if state. */
function extrasHtml(report: Report): string {
  const parts: string[] = [];

  if (report.checks.length > 0) {
    const label = new Map(report.agents.map((a) => [a.agent, a.label]));
    const items = report.checks
      .map(
        (c) =>
          `<li class="${c.severity === 'warn' ? 'warn' : ''}">${c.severity === 'warn' ? '! ' : ''}${c.tool ? `<b>${esc(label.get(c.tool) ?? c.tool)}:</b> ` : ''}${esc(c.message)}</li>`,
      )
      .join('');
    parts.push(
      `<details class="extra" open><summary>Checks (${report.checks.length})</summary><ul class="findings">${items}</ul></details>`,
    );
  }

  if (report.tree && report.tree.length > 1) {
    const head = report.agents.map((a) => `<th class="r">${esc(a.label)}</th>`).join('');
    const rows = report.tree
      .map(
        (row) =>
          `<tr><td class="p">${esc(row.dir)}</td>${report.agents.map((a) => `<td class="r">${num(row.tools[a.agent] ?? 0)}</td>`).join('')}</tr>`,
      )
      .join('');
    parts.push(
      `<details class="extra"><summary>By starting folder (${report.tree.length})</summary><div class="tw"><table><thead><tr><th>Folder</th>${head}</tr></thead><tbody>${rows}</tbody></table></div></details>`,
    );
  }

  const withMcp = report.agents.filter((a) => a.mcp);
  if (withMcp.length > 0) {
    const rows = withMcp
      .flatMap((a) =>
        (a.mcp?.servers ?? []).map(
          (s) =>
            `<tr><td>${esc(a.label)}</td><td>${esc(s.name)}</td><td>${esc(s.transport)}</td><td class="p">${esc(s.configPath)}</td><td>${esc(s.status)}</td><td class="r">${s.tokens === undefined ? '' : num(s.tokens)}</td></tr>`,
        ),
      )
      .join('');
    parts.push(
      `<details class="extra"><summary>MCP servers</summary><div class="tw"><table><thead><tr><th>Tool</th><th>Server</th><th>Type</th><th>Config</th><th>Status</th><th class="r">Tokens</th></tr></thead><tbody>${rows}</tbody></table></div><p class="sub">Tool-definition tokens are counted only with --mcp, and are an upper bound: some tools load MCP tools on demand.</p></details>`,
    );
  }

  parts.push(
    `<div class="extra share"><span>Share this run:</span> <button type="button" class="btn" data-share="png">Download card (PNG)</button> <button type="button" class="btn" data-share="svg">Download card (SVG)</button> <button type="button" class="btn" data-share="md">Copy PR summary (markdown)</button> <span id="share-status" role="status"></span></div>`,
  );
  return parts.join('\n');
}

/** Download and copy handlers for the share buttons; everything stays in the browser. */
const SHARE_SCRIPT = `(function(){
var $=function(id){return document.getElementById(id)};
var NS='http'+'://www.w3.org/2000/svg';
var card=function(){return $('share-card').textContent.replace('<svg ','<svg xmlns="'+NS+'" ')};
var status=function(t){var s=$('share-status');if(s)s.textContent=t};
function save(blob,name){var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href)},1000)}
function png(){var svg=card();var img=new Image();
img.onload=function(){var c=document.createElement('canvas');c.width=img.width*2;c.height=img.height*2;var x=c.getContext('2d');x.scale(2,2);x.drawImage(img,0,0);
c.toBlob(function(b){if(b){save(b,'ctxsize-card.png');status('Saved ctxsize-card.png')}else status('Could not make a PNG here; use the SVG.')},'image/png')};
img.onerror=function(){status('Could not make a PNG here; use the SVG.')};
img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)}
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-share]');if(!b)return;var k=b.getAttribute('data-share');
if(k==='png')png();
else if(k==='svg'){save(new Blob([card()],{type:'image/svg+xml'}),'ctxsize-card.svg');status('Saved ctxsize-card.svg')}
else if(k==='md'){var t=$('share-md').textContent;try{navigator.clipboard.writeText(t).then(function(){status('Copied')},function(){status('Copy was blocked; select the text from --markdown instead.')})}catch(err){status('Copy was blocked; use --markdown instead.')}}});
})();`;
