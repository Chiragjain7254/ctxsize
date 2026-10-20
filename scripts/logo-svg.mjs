// Writes the logo SVGs in docs/img from one definition, so the four files cannot drift apart:
//   node scripts/logo-svg.mjs
// The icon is three bars filling up, like a token meter. The wordmark draws its letters as
// strokes, so it looks the same on every machine and needs no font.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IMG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'img');

const THEMES = {
  light: { tile: '#2f6fed', bars: '#ffffff', ink: '#1a1918' },
  dark: { tile: '#3987e5', bars: '#0e1522', ink: '#f3f2ee' },
};

const icon = (t) =>
  `<rect width="64" height="64" rx="15" fill="${t.tile}"/>
<rect x="13" y="36" width="10" height="14" rx="2.5" fill="${t.bars}"/>
<rect x="27" y="24" width="10" height="26" rx="2.5" fill="${t.bars}"/>
<rect x="41" y="12" width="10" height="38" rx="2.5" fill="${t.bars}"/>`;

// Letters c t x s i z e, each in a 24-wide box whose top is the x-height line (y 0 .. 28).
const GLYPHS = {
  c: '<path d="M20 6.5A11 11 0 1 0 20 21.5"/>',
  t: '<path d="M10 -6V19Q10 25 16 25H20M3 4H19"/>',
  x: '<path d="M3 3L21 25M21 3L3 25"/>',
  s: '<path d="M19 7Q16 3 12 3C7 3 5 6 5 8.5C5 13 19 12 19 19.5C19 23 16 25 12 25Q8 25 5 21"/>',
  i: '<path d="M12 4V25M12 -8V-8"/>',
  z: '<path d="M4 3H20L4 25H20"/>',
  e: '<path d="M4 14H20C20 7 16 3 12 3C7 3 4 8 4 14C4 21 8 25 13 25Q17 25 20 22"/>',
};

function wordmark(t) {
  const letters = [...'ctxsize']
    .map((ch, i) => `<g transform="translate(${86 + i * 30} 18)">${GLYPHS[ch]}</g>`)
    .join('\n');
  return `<g fill="none" stroke="${t.ink}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
${letters}
</g>`;
}

const svg = (w, body, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="64" viewBox="0 0 ${w} 64" role="img" aria-label="${label}">
${body}
</svg>
`;

mkdirSync(IMG, { recursive: true });
for (const [name, t] of Object.entries(THEMES)) {
  const suffix = name === 'dark' ? '-dark' : '';
  writeFileSync(path.join(IMG, `logo-icon${suffix}.svg`), svg(64, icon(t), 'ctxsize'));
  writeFileSync(
    path.join(IMG, `logo-wordmark${suffix}.svg`),
    svg(298, `${icon(t)}\n${wordmark(t)}`, 'ctxsize'),
  );
}
console.error('Wrote docs/img/logo-icon*.svg and logo-wordmark*.svg');
