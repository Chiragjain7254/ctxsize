// @ts-nocheck
// The browser side of the interactive HTML report. pageMain() is copied into the page with
// Function.prototype.toString, so it must not use anything from outside itself: calc,
// squarify, document and window are passed in. That also lets a test run it against a stub
// DOM. All text that comes from the repo is escaped with esc() before it is put in markup.

export function pageMain(calc, squarify, document, window) {
  const $ = (id) => document.getElementById(id);
  let DATA = JSON.parse($('ctxsize-data').textContent);
  let MODELS = {};
  const W = 960;
  const H = 520;
  const GAP = 2;
  const CAT = {
    instructions: 'Instructions',
    rules: 'Rules',
    skills: 'Skills listing',
    memory: 'Memory',
  };
  const CATS = ['instructions', 'rules', 'skills', 'memory'];

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const pct = (v) => `${v < 10 ? v.toFixed(2) : v.toFixed(1)}%`;

  // UI state. Only the theme is remembered between visits; the rest is per page load.
  const S = {
    order: [],
    on: {},
    model: {},
    off: {},
    ctx: null,
    msgs: null,
    price: null,
    csort: null,
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

  // ---- tools list (rank, show, model) ----
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
<label class="tl"><input type="checkbox" data-act="on" data-id="${esc(id)}" data-f="on-${esc(id)}"${S.on[id] ? ' checked' : ''}> ${esc(a.label)}</label>
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

  // ---- comparison table ----
  const CCOLS = [
    ['label', 'Agent', false],
    ['model', 'Model', false],
    ['startup', 'Startup tokens', true],
    ['pct', '% of window', true],
    ['overhead', 'Overhead tokens', true],
    ['cost', 'Cost', true],
  ];
  function renderCompare() {
    let rows = S.order
      .filter((id) => S.on[id])
      .map((id) => {
        const a = agentById(id);
        return { a, r: result(a) };
      });
    if (S.csort) {
      const get = {
        label: (x) => x.a.label,
        model: (x) => modelLabel(x.r.model),
        startup: (x) => x.r.startup,
        pct: (x) => x.r.windowPct,
        overhead: (x) => x.r.overheadTokens,
        cost: (x) => x.r.costUsd,
      }[S.csort.k];
      rows = calc.sortRows(rows, get, S.csort.d);
    }
    const head = CCOLS.map(([k, label, right]) => {
      const on = S.csort && S.csort.k === k;
      const sort = on ? (S.csort.d === 1 ? 'ascending' : 'descending') : 'none';
      const arrow = on ? (S.csort.d === 1 ? ' &#9650;' : ' &#9660;') : '';
      return `<th${right ? ' class="r"' : ''} aria-sort="${sort}"><button type="button" class="sortb" data-act="csort" data-k="${k}" data-f="csort-${k}">${label}${arrow}</button></th>`;
    }).join('');
    const body = rows
      .map(({ a, r }) => {
        const changed = r.model !== a.model;
        return `<tr class="${S.tab === a.id ? 'cur' : ''}" data-act="tab" data-id="${esc(a.id)}"><td>${esc(a.label)}${a.hasDrops ? ' <span class="tb" title="drops files">&#10007;</span>' : ''}</td><td>${esc(modelLabel(r.model))}${changed ? ' <span class="chg" title="changed in this page">(changed)</span>' : ''}</td><td class="r">${est(a)}${num(r.startup)}</td><td class="r">${pct(r.windowPct)}</td><td class="r">${num(r.overheadTokens)}</td><td class="r">${calc.usd(r.costUsd)}</td></tr>`;
      })
      .join('');
    const msgs = globals().messages;
    $('compare').innerHTML = rows.length
      ? `<div class="tw"><table><caption class="sub">Cost of carrying the startup load for ${num(msgs)} messages, at the model's uncached input price (prompt caching lowers it). Click a row to open that tool.</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
      : '<p class="empty">No tool selected. Tick one above.</p>';
  }

  // ---- tabs and panel ----
  function renderTabs() {
    $('tabs').innerHTML = S.order
      .filter((id) => S.on[id])
      .map((id) => {
        const a = agentById(id);
        const r = result(a);
        const sel = S.tab === id;
        return `<button type="button" role="tab" id="tab-${esc(id)}" aria-controls="panel" aria-selected="${sel}"${sel ? '' : ' tabindex="-1"'} data-act="tab" data-id="${esc(id)}" data-f="tab-${esc(id)}"><span class="tl">${esc(a.label)}</span><span class="tv">${est(a)}${num(r.startup)}</span>${a.hasDrops ? '<span class="tb" title="drops files">&#10007;</span>' : ''}</button>`;
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
      (c) => `<span class="key"><i class="sw cat-${c}"></i>${CAT[c]}</span>`,
    );
    const lost = tiles.some((t) => t.status);
    if (lost) keys.push('<span class="key"><i class="sw lost-sw"></i>Dropped or cut off</span>');
    return keys.length > 1 || lost ? `<div class="legend">${keys.join('')}</div>` : '';
  }

  const FCOLS = [
    ['path', 'File', false],
    ['category', 'Category', false],
    ['load', 'Loads', false],
    ['tokens', 'Tokens', true],
    ['reason', 'Why', false],
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
    const head = FCOLS.map(([k, label, right]) => {
      const on = S.fsort.k === k;
      const sort = on ? (S.fsort.d === 1 ? 'ascending' : 'descending') : 'none';
      const arrow = on ? (S.fsort.d === 1 ? ' &#9650;' : ' &#9660;') : '';
      return `<th${right ? ' class="r"' : ''} aria-sort="${sort}"><button type="button" class="sortb" data-act="fsort" data-k="${k}" data-f="fsort-${k}">${label}${arrow}</button></th>`;
    }).join('');
    const body = rows
      .map(({ it, tokens }) => {
        const usable = it.load !== 'ignored' && !it.dropped;
        const name = it.skill ? `${it.path} (${it.skill})` : it.path;
        return `<tr class="${off[it.key] ? 'offrow' : ''}"><td class="tk"><input type="checkbox" data-act="item" data-id="${esc(a.id)}" data-k="${esc(it.key)}" aria-label="Count ${esc(name)}"${off[it.key] ? '' : ' checked'}${usable ? '' : ' disabled'}></td><td class="p">${esc(name)}</td><td>${CAT[it.category]}</td><td>${it.dropped ? 'dropped' : it.load}</td><td class="r">${num(tokens)}</td><td>${esc(it.reason)}</td></tr>`;
      })
      .join('');
    const n = Object.keys(off).length;
    return `<details open><summary>${a.items.length} files${q ? `, ${rows.length} match "${esc(S.q)}"` : ''}${n ? `, ${n} unticked` : ''}</summary><div class="tw"><table><thead><tr><th class="tk"><span class="vh">Count</span></th>${head}</tr></thead><tbody>${body}</tbody></table></div></details>`;
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
    const finds = a.findings
      .map(
        (f) =>
          `<li class="${f.cls}">${f.cls === 'bad' ? `<b>${esc(f.head)}</b>${esc(f.text)}` : esc(f.text)}</li>`,
      )
      .join('');
    panel.innerHTML = `<p class="stat"><b>${est(a)}${num(r.startup)}</b> tokens at startup · ${num(r.onDemand)} more on demand · ${pct(r.windowPct)} of a ${num(r.window)}-token window · ${num(r.overheadTokens)} tokens over ${num(msgs)} messages · ${calc.usd(r.costUsd)}</p>
${legendHtml(tiles)}
<div class="map">${treemapSvg(a, tiles)}</div>
${finds ? `<ul class="findings">${finds}</ul>` : ''}
${filesTable(a)}`;
  }

  // ---- everything that depends on the numbers (not the tools list or the inputs) ----
  function renderResults() {
    const active = document.activeElement;
    const f = active?.getAttribute ? active.getAttribute('data-f') : null;
    renderNotes();
    renderCompare();
    renderTabs();
    renderPanel();
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
    const live = $('live');
    if (live && DATA.watch) {
      live.hidden = false;
      live.textContent = `live · updated ${new Date().toLocaleTimeString()}`;
    }
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
    } else if (act === 'csort' || act === 'fsort') {
      const key = act === 'csort' ? 'csort' : 'fsort';
      const cur = S[key];
      if (cur && cur.k === k) {
        // Third click on the same header in the comparison table goes back to rank order.
        if (key === 'csort' && cur.d === (k === 'label' || k === 'model' ? -1 : 1)) S[key] = null;
        else S[key] = { k, d: -cur.d };
      } else {
        S[key] = {
          k,
          d:
            k === 'label' ||
            k === 'model' ||
            k === 'path' ||
            k === 'category' ||
            k === 'load' ||
            k === 'reason'
              ? 1
              : -1,
        };
      }
      renderResults();
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
    S.csort = null;
    S.fsort = { k: 'tokens', d: -1 };
    S.q = '';
    S.order = DATA.agents.map((a) => a.id);
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
      if (next && next.generated !== DATA.generated) {
        DATA = next;
        sync();
        renderAll();
      }
    };
    s.onerror = done;
    document.head.appendChild(s);
  }

  $('in-msgs').setAttribute('placeholder', String(DATA.messages));
  sync();
  renderAll();
  if (DATA.watch) window.setInterval(poll, DATA.watch.every);
}
