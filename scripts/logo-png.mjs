// Exports the logo SVGs in docs/img to transparent PNGs, using a Chrome or Edge that is already
// installed (nothing is downloaded):
//   node scripts/logo-svg.mjs && node scripts/logo-png.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IMG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'img');
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const browser = BROWSERS.find((b) => existsSync(b));
if (!browser) throw new Error('No Chrome or Edge found');

// name, width, height of the PNG (the SVGs are 64 high: the PNGs are 8x that).
const JOBS = [
  ['logo-icon', 512, 512],
  ['logo-icon-dark', 512, 512],
  ['logo-wordmark', 2384, 512],
  ['logo-wordmark-dark', 2384, 512],
];

const tmp = mkdtempSync(path.join(os.tmpdir(), 'ctxsize-logo-'));
for (const [name, w, h] of JOBS) {
  const svg = pathToFileURL(path.join(IMG, `${name}.svg`)).href;
  const page = path.join(tmp, `${name}.html`);
  writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent"><img src="${svg}" width="${w}" height="${h}" style="display:block">`,
  );
  const out = path.join(IMG, `${name}.png`);
  spawnSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--user-data-dir=${path.join(tmp, 'profile')}`,
      `--window-size=${w},${h}`,
      `--screenshot=${out}`,
      pathToFileURL(page).href,
    ],
    { stdio: 'ignore', timeout: 30_000 },
  );
  console.error(`docs/img/${name}.png  ${Math.round(statSync(out).size / 1024)} KB`);
}
rmSync(tmp, { recursive: true, force: true });
