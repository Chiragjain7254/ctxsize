// Rebuilds the screenshots in docs/img from the current build, using a Chrome or Edge that is
// already installed (nothing is downloaded).
//   node scripts/screenshots.mjs [path-to-example-repo]
// Needs: npm run build, docs/study/results.json (for study.png), and examples/secret-word.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli.mjs');
const IMG = path.join(ROOT, 'docs', 'img');
const EXAMPLE = path.resolve(process.argv[2] ?? path.join(ROOT, '..', 'ctxsize-examples'));
const SECRET = path.join(ROOT, 'examples', 'secret-word');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'ctxsize-shots-'));

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const browser = BROWSERS.find((b) => existsSync(b));
if (!browser) throw new Error('No Chrome or Edge found');

/** live: the page keeps a connection open, so wait in real time and stop the browser after. */
function shot(url, out, width, height, live = false) {
  spawnSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      live ? '--timeout=5000' : '--virtual-time-budget=4000',
      `--user-data-dir=${path.join(tmp, live ? 'profile-live' : 'profile')}`,
      `--window-size=${width},${height}`,
      `--screenshot=${out}`,
      url,
    ],
    { stdio: 'ignore', timeout: 30_000 },
  );
  const kb = Math.round(statSync(out).size / 1024);
  console.error(`${path.relative(ROOT, out)}  ${kb} KB`);
  if (kb > 300) console.error('  WARNING: over 300 KB');
}

const run = (args, cwd, env = {}) =>
  execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 1 << 26,
  });

// ---- ANSI text to an HTML page -----------------------------------------------------------
const COLORS = {
  30: '#6e7681',
  31: '#ff7b72',
  32: '#7ee787',
  33: '#e3b341',
  34: '#79c0ff',
  35: '#d2a8ff',
  36: '#76e3ea',
  37: '#c9d1d9',
  90: '#8b949e',
  91: '#ff7b72',
  92: '#7ee787',
  93: '#e3b341',
  94: '#79c0ff',
  95: '#d2a8ff',
  96: '#76e3ea',
  97: '#ffffff',
};
const ESC = String.fromCharCode(27);
const SGR_SPLIT = new RegExp(`(${ESC}\\[[0-9;]*m)`);
const SGR = new RegExp(`^${ESC}\\[([0-9;]*)m$`);
const stripAnsi = (l) => l.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ansiToHtml(text) {
  let open = false;
  let out = '';
  for (const part of text.split(SGR_SPLIT)) {
    const m = SGR.exec(part);
    if (!m) {
      out += esc(part);
      continue;
    }
    if (open) out += '</span>';
    open = false;
    const style = [];
    for (const code of m[1].split(';').map(Number)) {
      if (code === 1) style.push('font-weight:700');
      else if (code === 2) style.push('opacity:.65');
      else if (code === 3) style.push('font-style:italic');
      else if (COLORS[code]) style.push(`color:${COLORS[code]}`);
    }
    if (style.length) {
      out += `<span style="${style.join(';')}">`;
      open = true;
    }
  }
  return open ? `${out}</span>` : out;
}

function terminalPage(text, title) {
  const lines = text.replace(/\s+$/, '').split('\n');
  const width = Math.max(...lines.map((l) => stripAnsi(l).length), 60);
  const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;font:15px/1.45 "Cascadia Mono",Consolas,"DejaVu Sans Mono",monospace;color:#c9d1d9}
.win{padding:0}.bar{background:#161b22;padding:10px 16px;color:#8b949e;font-size:13px;border-bottom:1px solid #30363d;display:flex;gap:8px;align-items:center}
.dot{width:12px;height:12px;border-radius:50%;display:inline-block}pre{margin:0;padding:18px 22px;white-space:pre}
</style><div class="win"><div class="bar"><span class="dot" style="background:#ff5f56"></span><span class="dot" style="background:#ffbd2e"></span><span class="dot" style="background:#27c93f"></span>&nbsp;${esc(title)}</div><pre>${ansiToHtml(lines.join('\n'))}</pre></div>`;
  return { html, width: Math.ceil(width * 9.1) + 46, height: lines.length * 22 + 80 };
}

function writePage(name, html) {
  const file = path.join(tmp, name);
  writeFileSync(file, html);
  return pathToFileURL(file).href;
}

mkdirSync(IMG, { recursive: true });
const color = { FORCE_COLOR: '1' };

// 1. terminal.png
{
  const text = run([], EXAMPLE, color);
  const p = terminalPage(text, 'npx @chiragjain7254/ctxsize');
  shot(writePage('terminal.html', p.html), path.join(IMG, 'terminal.png'), p.width, p.height);
}

// 2. report-light.png and report-dark.png (and the file for the --serve screenshot)
{
  const htmlFile = path.join(tmp, 'report.html');
  run(['--html', '--out', htmlFile], EXAMPLE);
  const page = readFileSync(htmlFile, 'utf8');
  for (const theme of ['light', 'dark']) {
    const themed = page.replace(
      /<html([^>]*)>/,
      (_m, a) => `<html${a.replace(/\sdata-theme="[^"]*"/, '')} data-theme="${theme}">`,
    );
    shot(
      writePage(`report-${theme}.html`, themed),
      path.join(IMG, `report-${theme}.png`),
      1280,
      1500,
    );
  }
}

// 3. serve.png
{
  const port = 4391;
  const child = spawn(
    process.execPath,
    [CLI, EXAMPLE, '--serve', '--no-open', '--port', String(port)],
    { stdio: 'ignore' },
  );
  try {
    for (let i = 0; i < 50; i++) {
      const up = await new Promise((resolve) =>
        http
          .get({ host: '127.0.0.1', port, path: '/' }, (r) => {
            r.resume();
            resolve(true);
          })
          .on('error', () => resolve(false)),
      );
      if (up) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    shot(`http://localhost:${port}/`, path.join(IMG, 'serve.png'), 1280, 1500, true);
  } finally {
    child.kill();
  }
}

// 4. checks.png: the "Dropped or at risk" and "Checks" sections of the terminal report
{
  const text = run([], EXAMPLE, color);
  const lines = text.split('\n');
  const strip = stripAnsi;
  const grab = (head) => {
    const start = lines.findIndex((l) => strip(l).startsWith(head));
    if (start < 0) return [];
    let end = lines.findIndex((l, i) => i > start && strip(l) !== '' && !/^\s/.test(strip(l)));
    if (end < 0) end = lines.length;
    return [...lines.slice(start, end), ''];
  };
  const body = [...grab('Dropped or at risk'), ...grab('Checks')].join('\n');
  if (!body.trim())
    throw new Error('no "Dropped or at risk" or "Checks" section in the example output');
  const p = terminalPage(body, 'npx @chiragjain7254/ctxsize');
  shot(writePage('checks.html', p.html), path.join(IMG, 'checks.png'), p.width, p.height);
}

// 5. secret-word.png: the file tree next to ctxsize's prediction for Claude Code
{
  const copy = path.join(tmp, 'secret-word');
  cpSync(SECRET, copy, { recursive: true });
  mkdirSync(path.join(copy, '.git'));
  const rep = JSON.parse(run(['--agents', 'claude', '--json'], copy));
  const claude = rep.agents[0];
  const listFiles = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
  const loads = Object.fromEntries(claude.items.map((i) => [i.path, i.load]));
  const LABEL = {
    startup: ['startup', '#2da44e', 0],
    'on-demand': ['on demand', '#bf8700', 1],
    ignored: ['ignored', '#cf222e', 2],
    none: ['not read by Claude Code', '#8b949e', 3],
  };
  // One row per fruit. A skill body fruit loads only when the skill is used.
  const entries = [];
  for (const abs of listFiles(copy)) {
    const file = path.relative(copy, abs).split(path.sep).join('/');
    for (const line of readFileSync(abs, 'utf8').split(/\r?\n/)) {
      const m = /Secret fruit( in the skill (description|body))?: ([A-Z]+)/.exec(line);
      if (!m) continue;
      const load = loads[file] ?? 'none';
      const status = m[2] === 'body' && load !== 'ignored' && load !== 'none' ? 'on-demand' : load;
      entries.push({ file, fruit: m[3], status, note: m[2] ? ` (skill ${m[2]})` : '' });
    }
  }
  entries.sort((x, y) => LABEL[x.status][2] - LABEL[y.status][2] || x.file.localeCompare(y.file));
  const rows = entries
    .map((e) => {
      const [t, c] = LABEL[e.status];
      return `<tr><td class="f">${esc(e.file)}</td><td class="w">${esc(e.fruit)}${esc(e.note)}</td><td style="color:${c};font-weight:600">${t}</td></tr>`;
    })
    .join('');
  const known = entries.filter((e) => e.status === 'startup').map((e) => e.fruit);
  const files = entries;
  const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;color:#1f2328;font:15px/1.4 system-ui,"Segoe UI",sans-serif;padding:28px 32px}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#59636e}table{border-collapse:collapse;width:100%}
td,th{padding:6px 12px;border-bottom:1px solid #d1d9e0;text-align:left}th{color:#59636e;font-weight:600;font-size:13px}
.f{font-family:Consolas,monospace}.w{font-family:Consolas,monospace;color:#8250df;font-weight:700}
.box{margin-top:18px;padding:14px 16px;background:#f6f8fa;border-radius:8px}.box b{color:#2da44e}
</style><h1>examples/secret-word: what ctxsize predicts for Claude Code</h1>
<p>Every file holds one fruit. Claude Code should name only the startup fruits when asked.</p>
<table><tr><th>File</th><th>Fruit</th><th>Claude Code</th></tr>${rows}</table>
<div class="box">Predicted at startup: <b>${esc(known.join(', '))}</b> &nbsp;|&nbsp; ctxsize startup load: ${claude.startup.total} tokens (estimate)</div>`;
  shot(
    writePage('secret-word.html', html),
    path.join(IMG, 'secret-word.png'),
    960,
    120 + files.length * 34 + 110,
  );
}

// 6. study.png: heaviest repos from docs/STUDY.md's data
{
  const results = JSON.parse(
    readFileSync(path.join(ROOT, 'docs', 'study', 'results.json'), 'utf8'),
  );
  const heavy = results.results
    .map((r) => {
      const a = r.agents.reduce(
        (best, x) => (x.startupTokens > best.startupTokens ? x : best),
        r.agents[0],
      );
      return { repo: r.repo, tokens: a.startupTokens, agent: a.label };
    })
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);
  const max = heavy[0].tokens || 1;
  const bars = heavy
    .map(
      (h) =>
        `<tr><td class="n">${esc(h.repo)}</td><td class="b"><div style="width:${Math.max(2, Math.round((h.tokens / max) * 100))}%"></div></td><td class="v">${h.tokens.toLocaleString('en-US')}</td><td class="a">${esc(h.agent)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;color:#1f2328;font:15px/1.4 system-ui,"Segoe UI",sans-serif;padding:28px 32px}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#59636e}table{border-collapse:collapse;width:100%}
td{padding:6px 10px;border-bottom:1px solid #eaeef2}.n{font-family:Consolas,monospace;width:250px}.b{width:46%}
.b div{height:16px;background:#0969da;border-radius:3px}.v{text-align:right;font-variant-numeric:tabular-nums;width:80px}.a{color:#59636e}
</style><h1>Ten heaviest startup loads in ${results.results.length} popular repos</h1>
<p>Estimated tokens an agent loads before the first prompt, highest agent per repo. ctxsize ${esc(results.ctxsizeVersion)}, ${esc(results.date)}.</p>
<table>${bars}</table>`;
  shot(writePage('study.html', html), path.join(IMG, 'study.png'), 1000, 150 + heavy.length * 38);
}

rmSync(tmp, { recursive: true, force: true });
