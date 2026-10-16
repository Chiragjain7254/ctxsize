// @ts-nocheck
// The browser side of the interactive HTML report. pageMain() is copied into the page with
// Function.prototype.toString, so it must not use anything from outside itself: calc,
// squarify, document and window are passed in. That also lets a test run it against a stub
// DOM. All text that comes from the repo is escaped with esc() before it is put in markup.

export function pageMain(calc, squarify, summary, fmt, helpIcon, document, window) {
  const $ = (id) => document.getElementById(id);
  let DATA = JSON.parse($('ctxsize-data').textContent);
  let MODELS = {};
  const W = 960;
  const H = 340;
  const GAP = 2;
  const CAT = {
    instructions: 'Instructions',
    rules: 'Rules',
    skills: 'Skills listing',
    memory: 'Memory',
  };
  const CATS = ['instructions', 'rules', 'skills', 'memory'];

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const { num, pct } = fmt;

  // UI state. Only the theme is remembered between visits; the rest is per page load.
  const S = {
    order: [],
    on: {},
    model: {},
    off: {},
    ctx: null,
    msgs: null,
    price: null,
    sort: 'tokens',
    fsort: { k: 'tokens', d: -1 },
    tab: null,
    q: '',
  };

  function sync() {
    MODELS = {};
    for (const m of DATA.models) MODELS[m.id] = m;
    const ids = DATA.agents.map((a) => a.id);
    S.order = S.order
      .filter((id) => ids.includes(id))
      .concat(ids.filter((id) => !S.order.includes(id)));
    for (const id of ids) {
      if (!(id in S.on)) S.on[id] = true;
      if (S.model[id] && !MODELS[S.model[id]]) delete S.model[id];
    }
    const visible = S.order.filter((id) => S.on[id]);
    if (!S.tab || !visible.includes(S.tab)) S.tab = visible[0] || null;
  }

  const agentById = (id) => DATA.agents.find((a) => a.id === id);
  const astate = (a) => ({ model: S.model[a.id] || a.model, off: S.off[a.id] || {} });
  const globals = () => ({
    ctx: S.ctx,
    messages: S.msgs === null ? DATA.messages : S.msgs,
    price: S.price,
  });
  const result = (a) => calc.agentTotals(a, MODELS, astate(a), globals());
  const tokSpec = (a) => MODELS[astate(a).model] || MODELS[a.model] || { tok: 'o200k_base' };
  // "~" before a count means an estimate: only OpenAI models are counted with their own tokenizer.
  const est = (a) => (tokSpec(a).exact ? '' : '~');
  const modelLabel = (id) => (MODELS[id] ? MODELS[id].label : id);

  // ---- agents list (show, model, order); lives under "Adjust model, messages and price" ----
  function renderTools() {
    const list = $('tools');
    list.innerHTML = S.order
      .map((id, i) => {
        const a = agentById(id);
        const sel = astate(a).model;
        const opts = DATA.models
          .map(
            (m) =>
              `<option value="${esc(m.id)}"${m.id === sel ? ' selected' : ''}>${esc(m.label)}</option>`,
          )
          .join('');
        return `<li draggable="true" data-id="${esc(id)}"><span class="grip" aria-hidden="true">&#8942;&#8942;</span>
<label class="tl"><input type="checkbox" data-act="on" data-id="${esc(id)}" data-f="on-${esc(id)}"${S.on[id] ? ' checked' : ''}> <b>${esc(a.label)}</b></label>
<span class="arrow" aria-hidden="true">&rarr;</span>
<select data-act="model" data-id="${esc(id)}" data-f="model-${esc(id)}" aria-label="Model for ${esc(a.label)}">${opts}</select>
<button type="button" class="mv" data-act="up" data-id="${esc(id)}" data-f="up-${esc(id)}" aria-label="Move ${esc(a.label)} up"${i === 0 ? ' disabled' : ''}>&#9650;</button><button type="button" class="mv" data-act="down" data-id="${esc(id)}" data-f="down-${esc(id)}" aria-label="Move ${esc(a.label)} down"${i === S.order.length - 1 ? ' disabled' : ''}>&#9660;</button></li>`;
      })
      .join('');
  }

  // ---- notes when the model or window changed ----
  function renderNotes() {
    const out = [];
    const ctxLabels = [];
    for (const id of S.order) {
      const a = agentById(id);
      if (!S.on[id]) continue;
      const r = result(a);
      if (!r.rechecked) continue;
      if (r.model !== a.model) {
        out.push(
          `<li>${esc(a.label)}: limits were simulated for ${esc(modelLabel(a.model))} at run time; re-run ctxsize --model ${esc(id)}=${esc(r.model)} to re-check drops.</li>`,
        );
      } else {
        ctxLabels.push(`${a.label} (${modelLabel(a.model)})`);
      }
    }
    if (ctxLabels.length) {
      out.push(
        `<li>Window override: limits were simulated for each tool's own model and window at run time (${esc(ctxLabels.join(', '))}); re-run ctxsize --context ${num(S.ctx)} to re-check drops.</li>`,
      );
    }
    $('notes').innerHTML = out.length ? `<ul class="recheck">${out.join('')}</ul>` : '';
  }

  // ---- summary and problems ----
  const SUMHELP = { bad: 'dropped', warn: 'risk', ok: 'ok' };
  const MARK = { bad: '✗', warn: '!', ok: '✓', info: '•' };
  function activeProblems() {
    const on = S.order.filter((id) => S.on[id]);
    return summary.forAgents(DATA.problems, on);
  }
  function renderSummary() {
    const agents = S.order
      .filter((id) => S.on[id])
      .map((id) => {
        const a = agentById(id);
        const r = result(a);
        return {
          id,
          label: a.label,
          startup: r.startup,
          est: !tokSpec(a).exact,
          pct: r.windowPct,
          cost: r.costUsd,
        };
      });
    const lines = summary.summarize({
      messages: globals().messages,
      agents,
      problems: activeProblems(),
    });
    $('summary').innerHTML = `<h2 id="h-summary">Summary</h2><ul class="sum">${lines
      .map(
        (l) =>
          `<li class="${l.level}"><span class="mk" aria-hidden="true">${MARK[l.level]}</span><span>${esc(l.text)}${SUMHELP[l.level] ? ` ${helpIcon(SUMHELP[l.level])}` : ''}</span></li>`,
      )
      .join('')}</ul>`;
  }
  const LEVEL = { bad: 'Cut off', warn: 'At risk', info: 'Tip' };
  const LEVELHELP = { bad: 'dropped', warn: 'risk', info: 'tip' };
  const CODEHELP = { legacy: 'legacy', 'over-recommended-size': 'oversize' };
  function renderProblems() {
    const ps = activeProblems();
    const body = ps.length
      ? tipsFolded(ps)
      : '<p class="allgood"><span class="mk" aria-hidden="true">\u2713</span> Nothing to fix.</p>';
    $('problems').innerHTML =
      `<h2 id="h-problems">Problems &amp; how to fix ${helpIcon('checks')}</h2>${body}`;
  }

  // ---- how an agent is doing: red = something cut off, amber = something to fix, green = fine ----
  const problemsOf = (a) => DATA.problems.filter((p) => p.tools.includes(a.id));
  function statusOf(a) {
    const s = summary.statusOf(DATA.problems, a.id);
    if (s.bad > 0) return { cls: 'bad', text: `\u2717 ${s.bad} cut off` };
    if (s.warn > 0) return { cls: 'warn', text: `! ${s.warn} to fix` };
    return { cls: 'ok', text: '\u2713 Fine' };
  }
  const modelText = (a, r) => {
    const changed = r.model !== a.model;
    return `${esc(modelLabel(r.model))}${changed ? ' (changed)' : a.modelDefault ? '*' : ''}`;
  };

  // ---- comparison: one bar per agent ----
  function renderCompare() {
    let rows = S.order
      .filter((id) => S.on[id])
      .map((id) => {
        const a = agentById(id);
        return { a, r: result(a) };
      });
    if (S.sort === 'tokens') rows = calc.sortRows(rows, (x) => x.r.startup, -1);
    else if (S.sort === 'cost') rows = calc.sortRows(rows, (x) => x.r.costUsd, -1);
    else if (S.sort === 'name') rows = calc.sortRows(rows, (x) => x.a.label, 1);
    const msgs = globals().messages;
    const head = `<h2 id="h-compare">Which agent reads the most?</h2>`;
    if (rows.length === 0) {
      $('compare').innerHTML =
        `${head}<p class="empty">No agent is shown. Open &ldquo;Adjust model, messages and price&rdquo; below and tick one.</p>`;
      return;
    }
    const max = Math.max(...rows.map((x) => x.r.startup), 0);
    const body = rows
      .map(({ a, r }) => {
        const st = statusOf(a);
        const width = max > 0 && r.startup > 0 ? Math.max(1.5, (r.startup / max) * 100) : 0;
        return `<li><button type="button" class="row st-${st.cls}" data-act="open" data-id="${esc(a.id)}" data-f="open-${esc(a.id)}" aria-label="Open the details for ${esc(a.label)}">
<span class="who"><b>${esc(a.label)}</b><span class="mdl">&rarr; ${modelText(a, r)}</span><span class="stat">${st.text}</span></span>
<span class="bar"><span class="fill" style="width:${width.toFixed(1)}%"></span><b class="bv">${est(a)}${num(r.startup)}</b></span>
<span class="pc"><b>${pct(r.windowPct)}</b></span>
<span class="co"><b>${fmt.usd(r.costUsd)}</b></span></button></li>`;
      })
      .join('');
    const anyEst = rows.some(({ a }) => est(a));
    const anyDefault = rows.some(({ a, r }) => a.modelDefault && r.model === a.model);
    $('compare').innerHTML = `${head}
<p class="sub">Bar length is how much each agent reads from your files before your first message. Click an agent to see its details.</p>
<div class="bars-head" aria-hidden="false"><span>Agent &rarr; model ${helpIcon('model')}</span><span>Startup tokens ${helpIcon('startup')}</span><span>% of window ${helpIcon('pct')}</span><span>Cost for ${num(msgs)} messages ${helpIcon('cost')}</span></div>
<ol class="bars">${body}</ol>
<p class="legend"><span class="key"><i class="dotk ok"></i>Fine ${helpIcon('ok')}</span><span class="key"><i class="dotk warn"></i>Something to fix ${helpIcon('risk')}</span><span class="key"><i class="dotk bad"></i>Cut off ${helpIcon('dropped')}</span>${anyEst ? `<span class="key"><b>~</b> estimate ${helpIcon('estimate')}</span>` : ''}${anyDefault ? `<span class="key"><b>*</b> guessed model ${helpIcon('default')}</span>` : ''}</p>
<p class="sub fine">Cost assumes the model's normal input price with no caching, so the real price can be lower.</p>`;
  }

  // ---- tabs and panel ----
  function renderTabs() {
    $('tabs').innerHTML = S.order
      .filter((id) => S.on[id])
      .map((id) => {
        const a = agentById(id);
        const r = result(a);
        const sel = S.tab === id;
        return `<button type="button" role="tab" id="tab-${esc(id)}" aria-controls="panel" aria-selected="${sel}"${sel ? '' : ' tabindex="-1"'} data-act="tab" data-id="${esc(id)}" data-f="tab-${esc(id)}"><span class="tl">${esc(a.label)}</span><span class="tv">${est(a)}${num(r.startup)}</span></button>`;
      })
      .join('');
  }

  function tilesFor(a) {
    const off = S.off[a.id] || {};
    const spec = tokSpec(a);
    const q = S.q.toLowerCase();
    const tiles = [];
    for (const it of a.items) {
      if (off[it.key]) continue;
      if (it.load !== 'startup' && !it.dropped) continue;
      const name = it.skill ? `skill: ${it.skill}` : it.path;
      tiles.push({
        name,
        cat: it.category,
        tokens: calc.tokensOf(it, spec),
        reason: it.reason,
        status: it.dropped ? 'dropped' : '',
        dim: q !== '' && !name.toLowerCase().includes(q) && !it.path.toLowerCase().includes(q),
      });
    }
    for (const c of a.cuts) {
      if (off[c.of]) continue;
      tiles.push({
        name: `${c.name} (cut part)`,
        cat: c.category,
        tokens: c.tokens,
        reason: `cut by ${c.limit}`,
        status: 'cut',
        dim: q !== '' && !c.name.toLowerCase().includes(q),
      });
    }
    return tiles;
  }

  function treemapSvg(a, tiles) {
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
      const status = t.status === '' ? '' : t.status === 'cut' ? 'Cut off (lost)' : 'Dropped';
      const tip = [
        t.name,
        `${num(t.tokens)} tokens · ${((t.tokens / total) * 100).toFixed(1)}%`,
        CAT[t.cat],
        t.reason,
        status,
      ]
        .filter(Boolean)
        .join('\n');
      const short = t.name.split('/').pop() || t.name;
      const maxChars = Math.floor((w - 12) / 7);
      const label =
        short.length > maxChars ? `${short.slice(0, Math.max(0, maxChars - 1))}…` : short;
      const showLabel = w >= 56 && h >= 34 && maxChars >= 4;
      const showDir = showLabel && h >= 52 && t.name.includes('/');
      const dir = t.name.slice(0, t.name.lastIndexOf('/'));
      const dirLabel = dir.length > maxChars ? `…${dir.slice(dir.length - maxChars + 1)}` : dir;
      const f = (n) => n.toFixed(1);
      return `<g class="tile cat-${t.cat}${t.status ? ' lost' : ''}${t.dim ? ' dim' : ''}" tabindex="0" data-tip="${esc(tip)}"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="3"/>${
        w >= 6 && h >= 4
          ? `<rect class="strip" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(Math.min(4, h))}" rx="2"/>`
          : ''
      }${
        showLabel
          ? `<text x="${f(x + 8)}" y="${f(y + 21)}"><tspan class="n">${esc(label)}</tspan><tspan class="v" x="${f(x + 8)}" dy="15">${num(t.tokens)}${t.status ? (t.status === 'cut' ? ' cut' : ' dropped') : ''}</tspan></text>`
          : ''
      }${showDir ? `<text class="d" x="${f(x + 8)}" y="${f(y + h - 8)}">${esc(dirLabel)}</text>` : ''}</g>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(a.label)} startup tokens by file">${rects.join('')}</svg>`;
  }

  function legendHtml(tiles) {
    const keys = CATS.filter((c) => tiles.some((t) => t.cat === c)).map(
      (c) => `<span class="key"><i class="sw cat-${c}"></i>${CAT[c]}${helpIcon(c)}</span>`,
    );
    const lost = tiles.some((t) => t.status);
    if (lost)
      keys.push(
        `<span class="key"><i class="sw lost-sw"></i>Cut off or dropped${helpIcon('dropped')}</span>`,
      );
    return keys.length > 1 || lost ? `<div class="legend">${keys.join('')}</div>` : '';
  }

  const FCOLS = [
    ['path', 'File', false, 'file'],
    ['category', 'Category', false, 'category'],
    ['load', 'Loads', false, 'loads'],
    ['tokens', 'Tokens', true, 'token'],
    ['reason', 'Why', false, 'why'],
  ];
  function filesTable(a) {
    const spec = tokSpec(a);
    const off = S.off[a.id] || {};
    const q = S.q.toLowerCase();
    let rows = a.items
      .map((it) => ({ it, tokens: calc.tokensOf(it, spec) }))
      .filter(
        ({ it }) =>
          q === '' ||
          it.path.toLowerCase().includes(q) ||
          (it.skill || '').toLowerCase().includes(q),
      );
    const get = {
      path: (x) => x.it.path,
      category: (x) => CAT[x.it.category],
      load: (x) => (x.it.dropped ? 'dropped' : x.it.load),
      tokens: (x) => x.tokens,
      reason: (x) => x.it.reason,
    }[S.fsort.k];
    rows = calc.sortRows(rows, get, S.fsort.d);
    const head = FCOLS.map(([k, label, right, help]) => {
      const on = S.fsort.k === k;
      const sort = on ? (S.fsort.d === 1 ? 'ascending' : 'descending') : 'none';
      const arrow = on ? (S.fsort.d === 1 ? ' &#9650;' : ' &#9660;') : '';
      return `<th${right ? ' class="r"' : ''} aria-sort="${sort}"><button type="button" class="sortb" data-act="fsort" data-k="${k}" data-f="fsort-${k}">${label}${arrow}</button>${helpIcon(help)}</th>`;
    }).join('');
    const body = rows
      .map(({ it, tokens }) => {
        const usable = it.load !== 'ignored' && !it.dropped;
        const name = it.skill ? `${it.path} (${it.skill})` : it.path;
        return `<tr class="${off[it.key] ? 'offrow' : ''}"><td class="tk"><input type="checkbox" data-act="item" data-id="${esc(a.id)}" data-k="${esc(it.key)}" aria-label="Count ${esc(name)}"${off[it.key] ? '' : ' checked'}${usable ? '' : ' disabled'}></td><td class="p">${esc(name)}</td><td>${CAT[it.category]}</td><td>${it.dropped ? 'dropped' : it.load}</td><td class="r">${num(tokens)}</td><td>${esc(it.reason)}</td></tr>`;
      })
      .join('');
    const n = Object.keys(off).length;
    return `<details open><summary>${a.items.length} files${q ? `, ${rows.length} match "${esc(S.q)}"` : ''}${n ? `, ${n} unticked` : ''}</summary><div class="tw"><table><thead><tr><th class="tk"><span class="vh">Count</span>${helpIcon('count')}</th>${head}</tr></thead><tbody>${body}</tbody></table></div></details>`;
  }

  // What to do to make one agent read less: its biggest files first, then the tips that apply.
  function reduceTips(a, r) {
    const spec = tokSpec(a);
    const off = S.off[a.id] || {};
    const tips = [];
    const files = a.items
      .filter((it) => it.load === 'startup' && !it.dropped && !off[it.key])
      .map((it) => ({ it, tokens: calc.tokensOf(it, spec) }))
      .filter((x) => x.tokens > 0)
      .sort((x, y) => y.tokens - x.tokens)
      .slice(0, 3);
    for (const { it, tokens } of files) {
      const name = it.skill ? `skill ${it.skill}` : it.path;
      const share = r.startup > 0 ? Math.round((tokens / r.startup) * 100) : 0;
      tips.push(
        `<b>${esc(name)}</b> is ${share}% of what ${esc(a.label)} reads (${est(a)}${num(tokens)} tokens). Shorten it, or move the parts you need only sometimes into a skill or a rule that loads on demand.`,
      );
    }
    for (const p of problemsOf(a)) if (p.level === 'info') tips.push(esc(p.fix));
    if (files.length > 0) {
      tips.push('Untick a file in the table above to see how many tokens you would save.');
    }
    return tips;
  }

  // Things to fix are always shown; optional tips are folded so the list stays short.
  function tipsFolded(ps) {
    const fix = ps.filter((p) => p.level !== 'info');
    const tips = ps.filter((p) => p.level === 'info');
    return `${fix.length ? problemCards(fix) : '<p class="allgood"><span class="mk" aria-hidden="true">✓</span> Nothing to fix.</p>'}${tips.length ? `<details class="tipsd"><summary>${tips.length} optional ${tips.length === 1 ? 'tip' : 'tips'} to save tokens</summary>${problemCards(tips)}</details>` : ''}`;
  }

  function problemCards(ps) {
    return `<ul class="plist">${ps
      .map(
        (p) =>
          `<li class="${p.level}"><span class="bw"><span class="badge ${p.level}">${LEVEL[p.level]}</span>${helpIcon(LEVELHELP[p.level])}</span><div><p class="ptitle">${esc(p.title)}${CODEHELP[p.code] ? ` ${helpIcon(CODEHELP[p.code])}` : ''}</p><p class="pfix"><b>How to fix:</b> ${esc(p.fix)}</p></div></li>`,
      )
      .join('')}</ul>`;
  }

  function renderPanel() {
    const panel = $('panel');
    const a = S.tab && agentById(S.tab);
    if (!a) {
      panel.innerHTML = '';
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    panel.setAttribute('aria-labelledby', `tab-${a.id}`);
    const r = result(a);
    const tiles = tilesFor(a);
    const msgs = globals().messages;
    const ps = problemsOf(a);
    const tips = reduceTips(a, r);
    panel.innerHTML = `<h3 class="ptop">${esc(a.label)} <span class="mdl">&rarr; ${modelText(a, r)}</span></h3>
<div class="big">
<div><b>${est(a)}${num(r.startup)}</b><span>startup tokens ${helpIcon('startup')}</span></div>
<div><b>${pct(r.windowPct)}</b><span>of its ${num(r.window)}-token window ${helpIcon('pct')}</span></div>
<div><b>${fmt.usd(r.costUsd)}</b><span>over ${num(msgs)} messages ${helpIcon('cost')}</span></div>
<div><b>${num(r.onDemand)}</b><span>more, only when needed ${helpIcon('ondemand')}</span></div>
</div>
<h4>Problems for ${esc(a.label)}</h4>
${ps.length ? problemCards(ps) : '<p class="allgood"><span class="mk" aria-hidden="true">\u2713</span> Nothing to fix for this agent.</p>'}
<h4>What it reads</h4>
<p class="sub">These are the files ${esc(a.label)} reads before your first message. The bigger the box, the more tokens it takes.</p>
${legendHtml(tiles)}
<div class="map">${treemapSvg(a, tiles)}</div>
${filesTable(a)}
<h4>How to reduce it</h4>
${tips.length ? `<ul class="tips">${tips.map((t) => `<li>${t}</li>`).join('')}</ul>` : '<p class="sub">Nothing to reduce: this agent reads nothing from your repo at startup.</p>'}`;
  }

  // ---- fine print: the long notes and warnings, folded away ----
  function renderFine() {
    const out = [];
    let count = 0;
    for (const a of DATA.agents) {
      if (!S.on[a.id]) continue;
      const lines = a.notes.concat(a.warnings);
      if (lines.length === 0) continue;
      count += lines.length;
      const shown = lines.slice(0, 20).map((t) => `<li>${esc(t)}</li>`);
      if (lines.length > 20) shown.push(`<li>${lines.length - 20} more in --json</li>`);
      out.push(`<h4>${esc(a.label)}</h4><ul>${shown.join('')}</ul>`);
    }
    out.push(`<p class="sub">${esc(DATA.tokenizerNote)}</p>`);
    $('fine-body').innerHTML = out.join('');
    $('fine-count').textContent = count ? ` (${count})` : '';
  }

  // "(changed)" next to the Adjust heading when something there is not the way the report opened.
  function renderAdjustState() {
    const changed =
      Object.keys(S.model).length > 0 ||
      S.ctx !== null ||
      S.msgs !== null ||
      S.price !== null ||
      Object.values(S.off).some((o) => Object.keys(o).length > 0) ||
      DATA.agents.some((a) => !S.on[a.id]);
    $('adj-state').textContent = changed ? ' (changed)' : '';
  }

  // ---- everything that depends on the numbers (not the tools list or the inputs) ----
  function renderResults() {
    const active = document.activeElement;
    const f = active?.getAttribute ? active.getAttribute('data-f') : null;
    renderNotes();
    renderSummary();
    renderProblems();
    renderCompare();
    renderTabs();
    renderPanel();
    renderFine();
    renderAdjustState();
    if (f) {
      const el = document.querySelector(`[data-f="${f}"]`);
      if (el?.focus) el.focus();
    }
  }
  function renderAll() {
    const active = document.activeElement;
    const f = active?.getAttribute ? active.getAttribute('data-f') : null;
    renderTools();
    renderResults();
    if (f) {
      const el = document.querySelector(`[data-f="${f}"]`);
      if (el?.focus) el.focus();
    }
    renderLive();
  }

  // Live status (--serve and --watch): a dot, whether the server is reachable, and when the data last changed.
  let updatedAt = new Date();
  let connected = true;
  function renderLive() {
    const live = $('live');
    if (!live || !(DATA.watch || DATA.stream)) return;
    const at = updatedAt.toLocaleTimeString();
    live.hidden = false;
    live.className = connected ? 'live' : 'live off';
    $('live-text').textContent = connected
      ? `live · updated ${at}`
      : `disconnected · last updated ${at}, reconnecting`;
  }
  function applyData(next) {
    DATA = next;
    updatedAt = new Date();
    sync();
    renderAll();
    showToast('Files changed. The report was updated.');
  }

  // A short notice that fades after a few seconds; a newer one replaces an older one.
  let toastId = 0;
  function showToast(text) {
    const toast = $('toast');
    if (!toast) return;
    const mine = ++toastId;
    toast.textContent = text;
    toast.hidden = false;
    window.setTimeout(() => {
      if (mine === toastId) toast.hidden = true;
    }, 3000);
  }

  // ---- inputs ----
  function parseNum(text, integer) {
    const t = String(text)
      .replace(/[_,\s]/g, '')
      .toLowerCase();
    if (t === '') return null;
    const m = /^(\d+(?:\.\d+)?)([km]?)$/.exec(t);
    if (!m) return undefined;
    let n = Number(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1);
    if (integer) n = Math.round(n);
    return Number.isFinite(n) ? n : undefined;
  }
  function readInput(id, key, integer) {
    const el = $(id);
    const v = parseNum(el.value, integer);
    el.setAttribute('aria-invalid', v === undefined ? 'true' : 'false');
    if (v !== undefined) S[key] = v;
  }

  document.addEventListener('input', (e) => {
    const id = e.target?.id;
    if (id === 'in-ctx') readInput(id, 'ctx', true);
    else if (id === 'in-msgs') readInput(id, 'msgs', true);
    else if (id === 'in-price') readInput(id, 'price', false);
    else if (id === 'in-q') S.q = e.target.value.trim();
    else return;
    renderResults();
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    const act = t.getAttribute?.('data-act');
    if (!act) return;
    const id = t.getAttribute('data-id');
    if (act === 'on') {
      S.on[id] = t.checked;
      sync();
    } else if (act === 'sort') {
      S.sort = t.value;
    } else if (act === 'model') {
      const a = agentById(id);
      if (t.value === a.model) delete S.model[id];
      else S.model[id] = t.value;
    } else if (act === 'item') {
      const k = t.getAttribute('data-k');
      S.off[id] = S.off[id] || {};
      if (t.checked) delete S.off[id][k];
      else S.off[id][k] = true;
    } else return;
    renderAll();
  });

  function reorder(from, to) {
    S.order = calc.move(S.order, from, to);
    renderAll();
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    const act = el.getAttribute('data-act');
    const id = el.getAttribute('data-id');
    const k = el.getAttribute('data-k');
    if (act === 'up' || act === 'down') {
      const i = S.order.indexOf(id);
      reorder(i, i + (act === 'up' ? -1 : 1));
    } else if (act === 'fsort') {
      const cur = S.fsort;
      if (cur.k === k) S.fsort = { k, d: -cur.d };
      else S.fsort = { k, d: k === 'tokens' ? -1 : 1 };
      renderResults();
    } else if (act === 'open') {
      S.tab = id;
      renderResults();
      const target = $('details');
      if (target?.scrollIntoView) target.scrollIntoView({ block: 'start' });
    } else if (act === 'tab') {
      S.tab = id;
      renderResults();
    } else if (act === 'reset') {
      reset();
    } else if (act === 'theme') {
      toggleTheme();
    }
  });

  function reset() {
    S.on = {};
    S.model = {};
    S.off = {};
    S.ctx = null;
    S.msgs = null;
    S.price = null;
    S.sort = 'tokens';
    S.fsort = { k: 'tokens', d: -1 };
    S.q = '';
    S.order = DATA.agents.map((a) => a.id);
    $('in-sort').value = 'tokens';
    for (const id of ['in-ctx', 'in-msgs', 'in-price', 'in-q']) {
      $(id).value = '';
      $(id).setAttribute('aria-invalid', 'false');
    }
    sync();
    renderAll();
  }

  // Keyboard: arrows move between tabs.
  $('tabs').addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const ids = S.order.filter((id) => S.on[id]);
    const i = ids.indexOf(S.tab);
    S.tab = ids[(i + d + ids.length) % ids.length];
    renderResults();
    const next = document.querySelector(`[data-f="tab-${S.tab}"]`);
    if (next?.focus) next.focus();
    e.preventDefault();
  });

  // Drag and drop to rank tools (the up/down buttons are the keyboard way).
  const toolsEl = $('tools');
  let dragId = null;
  const rowOf = (e) => (e.target.closest ? e.target.closest('li[data-id]') : null);
  toolsEl.addEventListener('dragstart', (e) => {
    const li = rowOf(e);
    if (!li) return;
    dragId = li.getAttribute('data-id');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    }
    li.classList.add('dragging');
  });
  toolsEl.addEventListener('dragover', (e) => {
    const li = rowOf(e);
    if (!li || dragId === null) return;
    e.preventDefault();
    for (const x of toolsEl.querySelectorAll('.over')) x.classList.remove('over');
    li.classList.add('over');
  });
  toolsEl.addEventListener('drop', (e) => {
    const li = rowOf(e);
    if (!li || dragId === null) return;
    e.preventDefault();
    const to = S.order.indexOf(li.getAttribute('data-id'));
    const from = S.order.indexOf(dragId);
    dragId = null;
    reorder(from, to);
  });
  toolsEl.addEventListener('dragend', () => {
    dragId = null;
    for (const x of toolsEl.querySelectorAll('.dragging,.over'))
      x.classList.remove('dragging', 'over');
  });

  // Tooltip on treemap tiles.
  const tip = $('tip');
  const place = (e, el) => {
    tip.textContent = el.getAttribute('data-tip');
    tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14;
    let y = e.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  };
  const tileOf = (e) => (e.target.closest ? e.target.closest('.tile') : null);
  document.addEventListener('mousemove', (e) => {
    const el = tileOf(e);
    if (el) place(e, el);
    else tip.style.display = 'none';
  });
  document.addEventListener('focusin', (e) => {
    const el = tileOf(e);
    if (!el) return;
    const b = el.getBoundingClientRect();
    place({ clientX: b.left + 8, clientY: b.top + 8 }, el);
  });
  document.addEventListener('focusout', () => {
    tip.style.display = 'none';
  });

  // Help popover for the "i" buttons: hover, keyboard focus and tap. The text is copied from the
  // hidden definitions in the page (the same ones aria-describedby points at).
  const help = $('help');
  let pinned = null;
  let shownFor = null;
  const iconOf = (e) => (e.target?.closest ? e.target.closest('.ii') : null);
  function showHelp(icon) {
    const def = $(`h-${icon.getAttribute('data-help')}`);
    if (!def || !help) return;
    help.innerHTML = def.innerHTML.replace(/ id="[^"]*"/g, '');
    help.hidden = false;
    shownFor = icon;
    const b = icon.getBoundingClientRect();
    const r = help.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, b.left + b.width / 2 - r.width / 2),
      window.innerWidth - r.width - 8,
    );
    const below = b.bottom + 8 + r.height <= window.innerHeight || b.top - 8 - r.height < 0;
    help.style.left = `${left}px`;
    help.style.top = `${below ? b.bottom + 8 : b.top - 8 - r.height}px`;
  }
  function hideHelp() {
    if (help) help.hidden = true;
    if (shownFor?.classList) shownFor.classList.remove('on');
    shownFor = null;
    pinned = null;
  }
  document.addEventListener('pointerover', (e) => {
    const icon = iconOf(e);
    if (icon && e.pointerType === 'mouse' && !pinned) showHelp(icon);
  });
  document.addEventListener('pointerout', (e) => {
    if (iconOf(e) && e.pointerType === 'mouse' && !pinned) hideHelp();
  });
  document.addEventListener('focusin', (e) => {
    const icon = iconOf(e);
    if (icon && !pinned) showHelp(icon);
  });
  document.addEventListener('focusout', (e) => {
    if (iconOf(e) && !pinned) hideHelp();
  });
  document.addEventListener('click', (e) => {
    const icon = iconOf(e);
    if (icon && pinned !== icon) {
      hideHelp();
      pinned = icon;
      icon.classList.add('on');
      showHelp(icon);
    } else hideHelp();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideHelp();
  });

  // Theme: follows the system until the toggle is used; the choice is remembered if storage works.
  const root = document.documentElement;
  function effectiveTheme() {
    const set = root.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function toggleTheme() {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    $('theme').setAttribute('aria-pressed', String(next === 'dark'));
    try {
      window.localStorage.setItem('ctxsize-theme', next);
    } catch (_err) {
      // Storage can be blocked (private window, file:// policies); the toggle still works.
    }
  }
  try {
    const saved = window.localStorage.getItem('ctxsize-theme');
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  } catch (_err) {
    // Ignore: fall back to the system theme.
  }
  $('theme').setAttribute('aria-pressed', String(effectiveTheme() === 'dark'));

  // Watch mode: poll the sibling .data.js file with a script tag, which works from file://.
  function poll() {
    window.__ctxsizeData = undefined;
    const s = document.createElement('script');
    s.src = `${DATA.watch.file}?t=${Date.now()}`;
    const done = () => {
      if (s.parentNode) s.parentNode.removeChild(s);
    };
    s.onload = () => {
      const next = window.__ctxsizeData;
      done();
      if (next && next.generated !== DATA.generated) applyData(next);
    };
    s.onerror = done;
    document.head.appendChild(s);
  }

  $('in-msgs').setAttribute('placeholder', String(DATA.messages));
  sync();
  renderAll();
  if (DATA.watch) window.setInterval(poll, DATA.watch.every);

  // --serve: the server pushes new data over Server-Sent Events; the browser reconnects by itself.
  if (DATA.stream && window.EventSource) {
    const source = new window.EventSource(DATA.stream);
    source.onopen = () => {
      connected = true;
      renderLive();
    };
    // The browser reconnects by itself; until it does, say so instead of showing stale data as live.
    source.onerror = () => {
      connected = false;
      renderLive();
    };
    source.onmessage = (e) => {
      let next = null;
      try {
        next = JSON.parse(e.data);
      } catch (_err) {
        return;
      }
      if (next && next.generated !== DATA.generated) applyData(next);
    };
  }
}
