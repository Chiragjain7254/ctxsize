import { crc32, deflateSync } from 'node:zlib';

// A tiny offline PNG drawer: filled (rounded) rectangles and text in a built-in 5x7 pixel font.
// It exists so `--card card.png` needs no browser, no image library and no network. The text
// is deliberately pixel-art; the SVG card uses a real font.

/** 5x7 glyphs for ASCII 32-126: seven rows, top to bottom, five bits each (0x10 = leftmost). */
const FONT: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '!': [4, 4, 4, 4, 4, 0, 4],
  '"': [10, 10, 10, 0, 0, 0, 0],
  '#': [10, 10, 31, 10, 31, 10, 10],
  $: [4, 15, 20, 14, 5, 30, 4],
  '%': [24, 25, 2, 4, 8, 19, 3],
  '&': [12, 18, 20, 8, 21, 18, 13],
  "'": [12, 4, 8, 0, 0, 0, 0],
  '(': [2, 4, 8, 8, 8, 4, 2],
  ')': [8, 4, 2, 2, 2, 4, 8],
  '*': [0, 4, 21, 14, 21, 4, 0],
  '+': [0, 4, 4, 31, 4, 4, 0],
  ',': [0, 0, 0, 0, 12, 4, 8],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 12, 12],
  '/': [0, 1, 2, 4, 8, 16, 0],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  ':': [0, 12, 12, 0, 12, 12, 0],
  ';': [0, 12, 12, 0, 12, 4, 8],
  '<': [2, 4, 8, 16, 8, 4, 2],
  '=': [0, 0, 31, 0, 31, 0, 0],
  '>': [8, 4, 2, 1, 2, 4, 8],
  '?': [14, 17, 1, 2, 4, 0, 4],
  '@': [14, 17, 1, 13, 21, 21, 14],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 17, 25, 21, 19, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  '[': [14, 8, 8, 8, 8, 8, 14],
  '\\': [0, 16, 8, 4, 2, 1, 0],
  ']': [14, 2, 2, 2, 2, 2, 14],
  '^': [4, 10, 17, 0, 0, 0, 0],
  _: [0, 0, 0, 0, 0, 0, 31],
  '`': [8, 4, 2, 0, 0, 0, 0],
  a: [0, 0, 14, 1, 15, 17, 15],
  b: [16, 16, 22, 25, 17, 17, 30],
  c: [0, 0, 14, 16, 16, 17, 14],
  d: [1, 1, 13, 19, 17, 17, 15],
  e: [0, 0, 14, 17, 31, 16, 14],
  f: [6, 9, 8, 28, 8, 8, 8],
  g: [0, 15, 17, 17, 15, 1, 14],
  h: [16, 16, 22, 25, 17, 17, 17],
  i: [4, 0, 12, 4, 4, 4, 14],
  j: [2, 0, 6, 2, 2, 18, 12],
  k: [16, 16, 18, 20, 24, 20, 18],
  l: [12, 4, 4, 4, 4, 4, 14],
  m: [0, 0, 26, 21, 21, 17, 17],
  n: [0, 0, 22, 25, 17, 17, 17],
  o: [0, 0, 14, 17, 17, 17, 14],
  p: [0, 0, 30, 17, 30, 16, 16],
  q: [0, 0, 13, 19, 15, 1, 1],
  r: [0, 0, 22, 25, 16, 16, 16],
  s: [0, 0, 15, 16, 14, 1, 30],
  t: [8, 8, 28, 8, 8, 9, 6],
  u: [0, 0, 17, 17, 17, 19, 13],
  v: [0, 0, 17, 17, 17, 10, 4],
  w: [0, 0, 17, 17, 21, 21, 10],
  x: [0, 0, 17, 10, 4, 10, 17],
  y: [0, 0, 17, 17, 15, 1, 14],
  z: [0, 0, 31, 2, 4, 8, 31],
  '{': [2, 4, 4, 8, 4, 4, 2],
  '|': [4, 4, 4, 4, 4, 4, 4],
  '}': [8, 4, 4, 2, 4, 4, 8],
  '~': [0, 0, 8, 21, 2, 0, 0],
};

/** Width of one character cell (5 pixels of glyph and 1 of space) at the given scale. */
export const cellWidth = (scale: number): number => 6 * scale;

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** An RGB canvas that can be written out as a PNG. */
export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, background: string) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
    this.rect(0, 0, width, height, 0, background);
  }

  /** A filled rectangle with rounded corners of radius r (0 for square). */
  rect(x: number, y: number, w: number, h: number, r: number, fill: string): void {
    const [cr, cg, cb] = hexToRgb(fill);
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    const rad = Math.min(r, w / 2, h / 2);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        if (rad > 0) {
          // Distance from the nearest corner circle's centre, when in a corner square.
          const cx = px + 0.5 < x + rad ? x + rad : px + 0.5 > x + w - rad ? x + w - rad : px + 0.5;
          const cy = py + 0.5 < y + rad ? y + rad : py + 0.5 > y + h - rad ? y + h - rad : py + 0.5;
          if ((px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2 > rad * rad) continue;
        }
        const i = (py * this.width + px) * 3;
        this.data[i] = cr;
        this.data[i + 1] = cg;
        this.data[i + 2] = cb;
      }
    }
  }

  /** Text with its top-left (or right, or middle) at x, y; each font pixel is scale x scale. */
  text(
    s: string,
    x: number,
    y: number,
    scale: number,
    fill: string,
    anchor: 'start' | 'middle' | 'end' = 'start',
    bold = false,
  ): void {
    const width = s.length * cellWidth(scale) - scale;
    let cursor = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
    const extra = bold ? Math.max(1, Math.floor(scale / 4)) : 0;
    for (const ch of s) {
      const glyph = FONT[ch] ?? FONT['?'] ?? [];
      glyph.forEach((bits, row) => {
        for (let col = 0; col < 5; col++) {
          if ((bits >> (4 - col)) & 1) {
            this.rect(cursor + col * scale, y + row * scale, scale + extra, scale, 0, fill);
          }
        }
      });
      cursor += cellWidth(scale);
    }
  }

  toPng(): Buffer {
    const stride = this.width * 3;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let row = 0; row < this.height; row++) {
      raw[row * (stride + 1)] = 0; // filter: none
      raw.set(this.data.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
    }
    const chunk = (type: string, body: Buffer): Buffer => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(body.length, 0);
      head.write(type, 4, 'ascii');
      const tail = Buffer.alloc(4);
      tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
      return Buffer.concat([head, body, tail]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // colour type: RGB
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}
