import { countTokens, type Tokenizer, tokenizerLabel } from '../core/tokenize.ts';
import type { AgentReport, Category, LoadedItem, ModelInfo, Report } from '../core/types.ts';
import { allModels, type Model } from '../models.ts';
import { type CalcAgent, type CalcItem, type CalcModel, createCalc } from './calc.ts';
import { hiddenSentence, tokenizerSentence } from './common.ts';
import { glossaryHtml, helpDefs, helpIcon } from './glossary.ts';
import { pageMain } from './page-client.ts';
import { renderCardSvg, renderMarkdown } from './share.ts';
import { buildProblems, type Problem, summarize } from './summary.ts';
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
  /** True when ctxsize picked the model because none was given. */
  modelDefault: boolean;
  items: PageItem[];
  cuts: { of: string; name: string; category: Category; tokens: number; limit: string }[];
  /** Long notes and warnings: shown under "Fine print". */
  notes: string[];
  warnings: string[];
}

export interface PageData {
  version: string;
  messages: number;
  generated: string | null;
  watch: { file: string; every: number } | null;
  stream: string | null;
  models: PageModel[];
  /** "Tokens are estimates (...)", shown under "Fine print". */
  tokenizerNote: string;
  agents: PageAgent[];
  /** Everything worth fixing, worst first, each with a how-to-fix line. */
  problems: Problem[];
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
    modelDefault: agent.model.isDefault,
    items,
    cuts,
    notes: agent.notes,
    warnings: agent.warnings.map((w) => `${w.path ? `${w.path}: ` : ''}${w.message}`),
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
    tokenizerNote: `${tokenizerSentence(report)} Your files only: agents' own system prompts and tools are not counted.`,
    agents: report.agents.map(pageAgent),
    problems: buildProblems(report),
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
var summarize=${summarize.toString()};
var helpIcon=${helpIcon.toString()};
var pageMain=${pageMain.toString()};
pageMain(createCalc(), squarify, summarize, helpIcon, document, window);
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
<h1>What your coding agents read before you type</h1>
<span id="live" class="live" hidden><span class="dot" aria-hidden="true"></span><span id="live-text"></span></span>
<span class="hw"><button type="button" id="theme" class="btn" data-act="theme" aria-pressed="false">Light / dark</button>${helpIcon('theme')}</span>
</header>
<p class="lead">Coding agents read files from your repo, like AGENTS.md, before your first message. This page shows how much they read, what it costs and what to fix. Numbers marked ~ are estimates.</p>
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
<noscript><p class="empty">This report needs JavaScript. Startup tokens:</p><ul>${noscript}</ul></noscript>
<section id="summary" aria-labelledby="h-summary"></section>
<section id="problems" aria-labelledby="h-problems"></section>
<section id="compare" aria-labelledby="h-compare"></section>
${hiddenNote(report)}<section id="details" aria-labelledby="h-details">
<h2 id="h-details">Details for each agent</h2>
<p class="sub">Pick an agent to see what it reads, why, and how to make it read less.</p>
<div role="tablist" aria-label="Agents" id="tabs"></div>
<section role="tabpanel" id="panel"></section>
</section>
<details id="adjust" class="adv"><summary>Adjust model, messages and price<span id="adj-state"></span></summary>
<p class="sub">Ask &ldquo;what if&rdquo;. These controls only change this page, never your files.</p>
<div id="notes" aria-live="polite"></div>
<section class="controls" aria-label="Adjust">
<div class="grp"><h3>Agents and models ${helpIcon('include')} ${helpIcon('model')} ${helpIcon('order')}</h3><p class="sub">Tick the agents to show, pick the model each one uses, and drag (or use the arrows) to change their order.</p><ul id="tools" class="tools"></ul></div>
<div class="grp fields">
<label><span>Context window ${helpIcon('window')}</span> <input id="in-ctx" inputmode="numeric" placeholder="model's own" aria-invalid="false"></label>
<label><span>Messages ${helpIcon('messages')}</span> <input id="in-msgs" inputmode="numeric" aria-invalid="false"></label>
<label><span>Price, USD per 1M tokens ${helpIcon('price')}</span> <input id="in-price" inputmode="decimal" placeholder="model's own" aria-invalid="false"></label>
<label><span>Sort bars by ${helpIcon('sort')}</span> <select id="in-sort" data-act="sort"><option value="tokens">Most tokens first</option><option value="cost">Highest cost first</option><option value="name">Name, A to Z</option><option value="mine">My order</option></select></label>
<label><span>Search files ${helpIcon('search')}</span> <input id="in-q" type="search" placeholder="path contains..."></label>
<span class="hw"><button type="button" class="btn" data-act="reset">Reset</button>${helpIcon('reset')}</span>
</div>
</section>
</details>
<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--bg)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--bad)" stroke-width="2"/></pattern></defs></svg>
<details id="fine" class="adv"><summary>Fine print<span id="fine-count"></span></summary><p class="sub">Long notes and warnings about how each agent was modelled.</p><div id="fine-body"></div></details>
${extrasHtml(report)}
<details class="extra" id="glossary"><summary>What do these words mean?</summary>${glossaryHtml()}</details>
<footer>Generated by ctxsize v${esc(report.tool.version)}. Limits come from each agent's documentation; see the project README for sources. Everything on this page runs offline.</footer>
</main>
<div id="tip" role="tooltip"></div>
<div id="help" role="tooltip" hidden></div>
<div id="help-defs" hidden>${helpDefs()}</div>
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
:root{color-scheme:light;--bg:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--ink3:#7a7974;--line:#e4e3df;--chip:#f0efec;--card:#fff;
--c1:#2a78d6;--c2:#8a63d2;--c3:#1f93ad;--c4:#7a7974;--bad:#c62f2f;--warn:#9a6200;--ok:#1b7f4b;--tint:22%}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--ink3:#8f8e88;--line:#383835;--chip:#262624;--card:#212120;
--c1:#3987e5;--c2:#9d7be0;--c3:#35b1cc;--c4:#9a9992;--bad:#f07575;--warn:#f5b73a;--ok:#4cc38a;--tint:30%}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--ink3:#8f8e88;--line:#383835;--chip:#262624;--card:#212120;
--c1:#3987e5;--c2:#9d7be0;--c3:#35b1cc;--c4:#9a9992;--bad:#f07575;--warn:#f5b73a;--ok:#4cc38a;--tint:30%}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:28px 16px 56px}
h1{font-size:26px;line-height:1.25;margin:0;flex:1 1 320px}
h2{font-size:20px;margin:0 0 6px}h3{font-size:16px;margin:0 0 4px}h4{font-size:15px;margin:22px 0 6px}
section{margin-top:32px}
.top{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.lead{color:var(--ink2);margin:8px 0 0;max-width:70ch}
.sub{color:var(--ink2);margin:2px 0 12px;font-size:15px}.sub.fine{font-size:13px;color:var(--ink3);margin-top:10px}
.live{color:var(--ok);font-size:13px;display:inline-flex;align-items:center;gap:6px}.live[hidden]{display:none}
.live .dot{width:8px;height:8px;border-radius:50%;background:currentColor}.live.off{color:var(--bad)}
.toast{position:fixed;right:16px;bottom:16px;max-width:min(360px,calc(100vw - 32px));background:var(--ink);color:var(--bg);padding:10px 14px;border-radius:8px;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.25);z-index:4}.toast[hidden]{display:none}
.btn,.sortb,.mv{font:inherit;color:var(--ink);background:var(--chip);border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer}
.btn:hover,.mv:hover:not(:disabled){border-color:var(--ink2)}.mv{padding:0 6px;font-size:11px}.mv:disabled{opacity:.35;cursor:default}
.sortb{background:none;border:0;padding:0;font-weight:600;color:var(--ink2)}
button:focus-visible,input:focus-visible,select:focus-visible,.tile:focus-visible,summary:focus-visible{outline:2px solid var(--c1);outline-offset:2px}
.sum,.plist,.tips{list-style:none;margin:0;padding:0}
.sum li{display:flex;gap:10px;padding:6px 0;font-size:18px;line-height:1.45}
.mk{font-weight:700;width:1.3em;flex:none;text-align:center}
.sum .bad .mk{color:var(--bad)}.sum .warn .mk{color:var(--warn)}.sum .ok .mk,.allgood .mk{color:var(--ok)}.sum .info .mk{color:var(--ink3)}
.allgood{color:var(--ok);font-weight:600;margin:6px 0}
.plist li{display:flex;gap:12px;padding:12px;margin:8px 0;border:1px solid var(--line);border-left:5px solid var(--ink3);border-radius:8px;background:var(--card)}
.plist li.bad{border-left-color:var(--bad)}.plist li.warn{border-left-color:var(--warn)}
.ptitle{margin:0;font-weight:600}.pfix{margin:3px 0 0;color:var(--ink2)}
.bw{flex:none;align-self:flex-start;display:inline-flex;align-items:center}
.badge{font-size:12px;font-weight:700;border-radius:999px;padding:1px 10px;border:1.5px solid currentColor;white-space:nowrap}
.badge.bad{color:var(--bad)}.badge.warn{color:var(--warn)}.badge.info{color:var(--ink2)}
.tips{list-style:disc;padding-left:20px}.tips li{margin:4px 0;color:var(--ink2)}.tips b{color:var(--ink)}
.bars-head,.row{display:grid;grid-template-columns:minmax(150px,1.5fr) minmax(160px,3fr) 72px 96px;gap:14px;align-items:center}
.bars-head{font-size:13px;font-weight:600;color:var(--ink2);padding:0 12px 4px}.bars-head span:nth-child(n+3){text-align:right}
.bars{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.row{width:100%;text-align:left;font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer}
.row:hover{border-color:var(--ink2)}
.tipsd{margin-top:8px}.tipsd>summary{font-weight:400;color:var(--ink2)}
.row .who{display:flex;flex-direction:column;gap:1px;min-width:0}.row .who b{font-size:16px}
.mdl{color:var(--ink2);font-size:14px;font-weight:400}
.stat{font-size:13px;font-weight:600;color:var(--ok)}.st-warn .stat{color:var(--warn)}.st-bad .stat{color:var(--bad)}
.bar{position:relative;display:flex;align-items:center;height:30px;background:var(--chip);border-radius:6px;overflow:hidden}
.fill{position:absolute;left:0;top:0;bottom:0;background:var(--ok);opacity:.35}.st-warn .fill{background:var(--warn)}.st-bad .fill{background:var(--bad)}
.bv{position:relative;padding:0 10px;font-size:20px;font-variant-numeric:tabular-nums}
.pc,.co{text-align:right;font-variant-numeric:tabular-nums}.pc b,.co b{font-size:17px}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin:12px 0 0;color:var(--ink2);font-size:13px}
.key{display:inline-flex;align-items:center;gap:6px}
.dotk{width:12px;height:12px;border-radius:50%;display:inline-block;background:var(--ok)}.dotk.warn{background:var(--warn)}.dotk.bad{background:var(--bad)}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block;background:var(--c)}
[role=tablist]{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 14px}
[role=tab]{font:inherit;color:var(--ink2);background:var(--chip);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer;display:flex;gap:8px;align-items:baseline}
[role=tab][aria-selected=true]{color:var(--ink);border-color:var(--c1);background:var(--bg);box-shadow:0 0 0 1px var(--c1)}
.tv{font-variant-numeric:tabular-nums;font-weight:600;color:var(--ink)}
#panel{border:1px solid var(--line);border-radius:10px;padding:16px;background:var(--card)}
.ptop{font-size:20px;margin:0 0 12px}.ptop .mdl{font-size:15px}
.big{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.big div{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--bg)}
.big b{font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}.big span{color:var(--ink2);font-size:13px}
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
.empty{padding:32px;text-align:center;color:var(--ink2);border:1px dashed var(--line);border-radius:8px}
details{margin-top:14px}summary{cursor:pointer;color:var(--ink);font-weight:600}
details.adv,details.extra{border:1px solid var(--line);border-radius:10px;padding:12px 16px;background:var(--card)}
details.adv>summary,details.extra>summary{font-size:16px}#adj-state,#fine-count{color:var(--warn);font-weight:400}#fine-count{color:var(--ink3)}
.controls{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:20px;margin-top:8px}
@media (max-width:760px){.controls{grid-template-columns:1fr}}
.tools{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.tools li{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--chip);cursor:grab}
.tools li.dragging{opacity:.4}.tools li.over{border-color:var(--c1);box-shadow:0 0 0 1px var(--c1)}
.grip{color:var(--ink3);letter-spacing:-2px;user-select:none}.tl{flex:0 1 auto;min-width:0}.arrow{color:var(--ink3)}
.tools select{font:inherit;font-size:13px;flex:1 1 140px;max-width:220px;min-width:0;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:4px}
.fields{display:grid;gap:8px;align-content:start}
.fields label{display:grid;gap:2px;font-size:14px;color:var(--ink2)}
.fields input,.fields select{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:4px 6px}
.fields input[aria-invalid=true]{border-color:var(--bad)}
.recheck{margin:0 0 12px;padding:8px 12px 8px 28px;border:1px solid var(--warn);border-radius:8px;color:var(--ink2);font-size:13px}
.extra{margin-top:14px}.share{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--ink2);margin-top:18px}#share-status{color:var(--ink2);font-size:13px}
#fine-body h4{margin:14px 0 4px}#fine-body ul{margin:0;padding-left:20px;color:var(--ink2);font-size:14px}
.tw{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}
caption{text-align:left}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--ink2);font-weight:600;white-space:nowrap}.r{text-align:right;font-variant-numeric:tabular-nums}th.r .sortb{text-align:right}.p{word-break:break-all}
.tk{width:28px;padding-right:0}.offrow td{color:var(--ink3);text-decoration:line-through}.offrow td.tk{text-decoration:none}
.vh{position:absolute;left:-9999px}
.findings{margin:10px 0;padding-left:18px;color:var(--ink2)}.findings li{margin:3px 0}.findings .warn{color:var(--warn)}
#tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--bg);font-size:12px;line-height:1.45;padding:7px 10px;border-radius:6px;white-space:pre-line;max-width:340px;display:none;z-index:2}
footer{margin-top:32px;color:var(--ink3);font-size:13px}
.ii{font:italic 700 10px/1 Georgia,serif;width:16px;height:16px;padding:0;margin:0 0 0 4px;border-radius:50%;border:1.5px solid var(--ink3);color:var(--ink3);background:none;cursor:help;vertical-align:middle;display:inline-flex;align-items:center;justify-content:center;flex:none}
.ii:hover,.ii:focus-visible,.ii.on{color:var(--c1);border-color:var(--c1)}
.hw{display:inline-flex;align-items:center}
#help{position:fixed;z-index:3;max-width:min(320px,calc(100vw - 24px));background:var(--ink);color:var(--bg);font-size:13px;line-height:1.45;padding:9px 12px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);font-weight:400}
#help[hidden]{display:none}#help b{display:block;margin-bottom:2px}#help i{display:block;margin-top:4px;opacity:.85}
#glossary dt{font-weight:600;margin-top:10px}#glossary dd{margin:2px 0 0;color:var(--ink2)}#glossary h3{font-size:14px;margin:18px 0 0}
@media (max-width:640px){
h1{font-size:22px}.sum li{font-size:16px}
.bars-head{display:none}
.row{grid-template-columns:1fr auto;gap:6px 12px}.row .who{grid-column:1/-1}.row .bar{grid-column:1/-1;grid-row:2}
.row .pc{grid-row:3;text-align:left}.row .pc b::after{content:" of window";font-weight:400;font-size:13px;color:var(--ink2)}.row .co{grid-row:3}.row .co b::after{content:" over the session";font-weight:400;font-size:13px;color:var(--ink2)}
.row .co,.row .pc{align-self:center}
#panel{padding:12px}.plist li{flex-direction:column;gap:6px}
}
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
      `<details class="extra"><summary>MCP servers</summary><p class="sub hw">What these are ${helpIcon('mcp')}</p><div class="tw"><table><thead><tr><th>Tool</th><th>Server</th><th>Type</th><th>Config</th><th>Status</th><th class="r">Tokens</th></tr></thead><tbody>${rows}</tbody></table></div><p class="sub">Tool-definition tokens are counted only with --mcp, and are an upper bound: some tools load MCP tools on demand.</p></details>`,
    );
  }

  parts.push(
    `<div class="extra share"><span>Share this run: ${helpIcon('share')}</span> <button type="button" class="btn" data-share="png">Download card (PNG)</button> <button type="button" class="btn" data-share="svg">Download card (SVG)</button> <button type="button" class="btn" data-share="md">Copy PR summary (markdown)</button> <span id="share-status" role="status"></span></div>`,
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
