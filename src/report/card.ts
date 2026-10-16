import type { Report } from '../core/types.ts';
import { Canvas } from './pixel.ts';
import { buildProblems, type Grade, reportGrades } from './summary.ts';

// The share card: the grade, the three things to fix first and what each agent reads, on a
// 1200x630 picture that stays readable when a social site shrinks it. One layout feeds two
// renderers: an SVG (real font) and a PNG (built-in pixel font, see pixel.ts). Everything is
// drawn locally; nothing is fetched.

export interface CardOptions {
  /** Shown in the card header; default "Context health report". */
  title?: string;
}

export const CARD_W = 1200;
export const CARD_H = 630;

const INK = '#1a1918';
const MUTED = '#5e5d59';
const PAPER = '#fbfaf7';
const TRACK = '#e6e3dc';
const BAR = '#2f6fed';
const GRADE_COLOR: Record<string, string> = {
  A: '#1b7f4b',
  B: '#4d8a1f',
  C: '#9a6200',
  D: '#c4501b',
  F: '#c62f2f',
  '-': '#7a7974',
};

export const gradeColor = (letter: string): string => GRADE_COLOR[letter] ?? '#7a7974';

type Item =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number; fill: string }
  | {
      kind: 'text';
      s: string;
      x: number;
      y: number;
      scale: number;
      fill: string;
      anchor: 'start' | 'middle' | 'end';
      bold: boolean;
    };

const num = (n: number) => n.toLocaleString('en-US');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Cuts at n characters with "..."; the card must never run past its column. */
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 3).trimEnd()}...`);

function layout(report: Report, opts: CardOptions): Item[] {
  const items: Item[] = [];
  const rect = (x: number, y: number, w: number, h: number, r: number, fill: string) =>
    items.push({ kind: 'rect', x, y, w, h, r, fill });
  const text = (
    s: string,
    x: number,
    y: number,
    scale: number,
    fill = INK,
    anchor: 'start' | 'middle' | 'end' = 'start',
    bold = false,
  ) => items.push({ kind: 'text', s, x, y, scale, fill, anchor, bold });

  const grades = reportGrades(report);
  const overall: Grade | null = grades.overall;
  const letter = overall?.letter ?? '-';
  const problems = buildProblems(report).filter((p) => p.level !== 'info');

  rect(0, 0, CARD_W, CARD_H, 0, PAPER);

  // Header: a small token meter, the name, the title.
  for (const [i, h] of [14, 22, 30].entries()) rect(48 + i * 12, 54 - h, 8, h, 2, BAR);
  text('ctxsize', 92, 28, 3, INK, 'start', true);
  text('Tokens are estimates', 1152, 32, 2, MUTED, 'end');
  text(clip(opts.title ?? 'Context health report', 36), 48, 84, 5, INK, 'start', true);

  // The grade.
  const color = gradeColor(letter);
  rect(48, 168, 300, 300, 28, color);
  text(letter, 198, 226, 24, '#ffffff', 'middle', true);
  text('Context health', 48, 486, 3, INK, 'start', true);
  text(overall ? `${overall.score} / 100` : 'nothing to grade', 48, 520, 3, MUTED);

  // The first three things to fix.
  const colX = 392;
  text('Fix these first', colX, 168, 3, INK, 'start', true);
  const first = problems.slice(0, 3);
  if (first.length === 0) {
    text(overall ? 'Nothing to fix.' : 'No agent files found.', colX, 210, 3, GRADE_COLOR.A);
  } else {
    first.forEach((p, i) => {
      const y = 210 + i * 40;
      rect(
        colX,
        y - 2,
        28,
        28,
        6,
        p.level === 'bad' ? (GRADE_COLOR.F ?? INK) : (GRADE_COLOR.C ?? INK),
      );
      text(String(i + 1), colX + 14, y + 3, 3, '#ffffff', 'middle', true);
      text(clip(cap(p.short), 37), colX + 44, y + 1, 3);
    });
    if (problems.length > 3) {
      text(`+ ${problems.length - 3} more in the Fix list`, colX + 44, 210 + 3 * 40 + 1, 2, MUTED);
    }
  }

  // The agents: a bar of startup tokens and the agent's own grade.
  text('What each agent reads', colX, 356, 3, INK, 'start', true);
  const agents = report.agents;
  const shown = agents.length > 5 ? agents.slice(0, 4) : agents;
  const max = Math.max(1, ...shown.map((a) => a.startup.total));
  const barX = colX + 260;
  const barMax = 280;
  shown.forEach((a, i) => {
    const y = 398 + i * 38;
    const w = Math.max(3, Math.round((a.startup.total / max) * barMax));
    const g = grades.agents[a.agent]?.letter ?? '-';
    const est = a.model.exactTokenizer ? '' : '~';
    text(clip(a.label, 14), colX, y + 1, 3);
    rect(barX, y, barMax, 24, 4, TRACK);
    rect(barX, y, w, 24, 4, BAR);
    text(`${est}${num(a.startup.total)}`, barX + barMax + 12, y + 1, 3, INK);
    text(g, 1152, y + 1, 3, gradeColor(g), 'end', true);
  });
  if (agents.length > 5) {
    text(`+ ${agents.length - 4} more agents`, colX, 398 + 4 * 38 + 1, 2, MUTED);
  }
  if (agents.length === 0) text('No agent loads any files.', colX, 398, 3, MUTED);

  // Footer.
  text(`ctxsize v${report.tool.version}  |  npx @chiragjain7254/ctxsize`, 48, 596, 2, MUTED);
  text('No network. No telemetry.', 1152, 596, 2, MUTED, 'end');
  return items;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A 1200x630 SVG card. */
export function renderCardSvg(report: Report, opts: CardOptions = {}): string {
  const title = opts.title ?? 'Context health report';
  const grade = reportGrades(report).overall?.letter;
  const body = layout(report, opts)
    .map((it) => {
      if (it.kind === 'rect') {
        const r = it.r > 0 ? ` rx="${it.r}"` : '';
        return `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}"${r} fill="${it.fill}"/>`;
      }
      const size = it.scale * 10;
      const baseline = Math.round(it.y + it.scale * 7.4);
      const weight = it.bold ? ' font-weight="700"' : '';
      return `<text x="${it.x}" y="${baseline}" font-size="${size}"${weight} fill="${it.fill}" text-anchor="${it.anchor}">${esc(it.s)}</text>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" role="img" aria-label="${esc(title)}: context health grade ${esc(grade ?? 'none')}, the first fixes and the startup tokens of each coding agent">
<g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono',monospace">
${body}
</g>
</svg>
`;
}

/** The same card as a PNG, drawn with a built-in pixel font: no browser or image library needed. */
export function renderCardPng(report: Report, opts: CardOptions = {}): Buffer {
  const canvas = new Canvas(CARD_W, CARD_H, PAPER);
  for (const it of layout(report, opts)) {
    if (it.kind === 'rect') canvas.rect(it.x, it.y, it.w, it.h, it.r, it.fill);
    else canvas.text(it.s, it.x, it.y, it.scale, it.fill, it.anchor, it.bold);
  }
  return canvas.toPng();
}
