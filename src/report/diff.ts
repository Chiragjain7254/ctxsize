import type { DiffResult, HistoryResult } from '../history.ts';
import { fmt } from './format.ts';

// Terminal output for --diff and --history. Kept apart from terminal.ts, which renders the
// plain report.

const BLOCKS = '▁▂▃▄▅▆▇█';
/** Longest sparkline; more commits than this are averaged into buckets. */
const SPARK_WIDTH = 60;

const num = (n: number) => n.toLocaleString('en-US');
const signed = (n: number) => (n > 0 ? `+${num(n)}` : n < 0 ? `-${num(-n)}` : '0');
const signedPct = (n: number | null) =>
  n === null ? 'n/a' : `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n).toFixed(1)}%`;
const signedMoney = (n: number | null, currency: string) =>
  n === null
    ? 'n/a'
    : n === 0
      ? fmt.money(0, currency)
      : `${n > 0 ? '+' : '-'}${fmt.money(Math.abs(n), currency)}`;

function paint(enabled: boolean) {
  const wrap = (open: number, close: number) => (s: string) =>
    enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return { bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), green: wrap(32, 39) };
}

/** Unicode sparkline of values, scaled between their own min and max. */
export function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  let points = values;
  if (values.length > SPARK_WIDTH) {
    points = [];
    for (let i = 0; i < SPARK_WIDTH; i++) {
      const from = Math.floor((i * values.length) / SPARK_WIDTH);
      const to = Math.max(from + 1, Math.floor(((i + 1) * values.length) / SPARK_WIDTH));
      const slice = values.slice(from, to);
      points.push(slice.reduce((a, b) => a + b, 0) / slice.length);
    }
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  if (max === min) return (BLOCKS[0] ?? '').repeat(points.length);
  return points
    .map((v) => BLOCKS[Math.round(((v - min) / (max - min)) * (BLOCKS.length - 1))])
    .join('');
}

function columns(header: string[], rows: string[][], dim: (s: string) => string): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) =>
    `  ${cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0))).join('  ')}`.trimEnd();
  return [dim(line(header)), ...rows.map(line)];
}

export function renderDiff(diff: DiffResult, opts: { color: boolean }): string {
  const c = paint(opts.color);
  const tint = (n: number, s: string) => (n > 0 ? c.red(s) : n < 0 ? c.green(s) : s);
  const messages = diff.tools[0]?.overhead.messages ?? 0;
  const price = diff.price;
  const out: string[] = [
    '',
    `${c.bold(`Change since ${diff.base.ref}`)} ${c.dim(`(${diff.base.commit.slice(0, 7)} -> working tree)`)}`,
    ...columns(
      [
        'Agent',
        'Before',
        'After',
        'Delta',
        'Delta %',
        ...(price ? [`Cost over ${num(messages)} msgs`] : []),
      ],
      diff.tools.map((t) => [
        t.label,
        num(t.before),
        num(t.after),
        signed(t.delta),
        signedPct(t.deltaPct),
        ...(price ? [signedMoney(t.overhead.deltaCost, price.currency)] : []),
      ]),
      c.dim,
    ),
  ];
  const mark = { added: '+', removed: '-', changed: '~' } as const;
  for (const t of diff.tools) {
    if (t.files.length === 0) continue;
    out.push('', `  ${c.bold(t.label)}`);
    for (const f of t.files) {
      out.push(
        `    ${mark[f.status]} ${f.path}  ${tint(f.delta, signed(f.delta))} ${c.dim(`(${num(f.before)} -> ${num(f.after)})`)}`,
      );
    }
    const total = t.fileCounts.added + t.fileCounts.removed + t.fileCounts.changed;
    if (total > t.files.length) {
      out.push(c.dim(`    ... ${total - t.files.length} more files changed`));
    }
  }
  out.push(
    '',
    c.dim(
      price
        ? '  Tokens are estimates; cost is startup tokens x messages at the price you gave (uncached).'
        : '  Tokens are estimates. Add --price 3 --per 1m to see cost.',
    ),
  );
  return `${out.join('\n')}\n`;
}

export function renderHistory(
  history: HistoryResult,
  opts: { color: boolean; labels?: Record<string, string> },
): string {
  const c = paint(opts.color);
  if (history.entries.length === 0) {
    return `${c.bold('History')}\n  No commits yet, nothing to analyze.\n`;
  }
  const first = history.entries[0];
  const last = history.entries[history.entries.length - 1];
  const out: string[] = [
    `${c.bold(
      history.analyzed === 1
        ? 'Startup tokens at the last commit'
        : `Startup tokens over the last ${history.analyzed} commits`,
    )} ${c.dim(`(${first?.commit.slice(0, 7)} to ${last?.commit.slice(0, 7)}, oldest to newest)`)}`,
  ];
  const rows = Object.keys(first?.tools ?? {}).map((id) => {
    const series = history.entries.map((e) => e.tools[id] ?? 0);
    return [
      opts.labels?.[id] ?? id,
      sparkline(series),
      num(series[0] ?? 0),
      num(series[series.length - 1] ?? 0),
      num(Math.min(...series)),
      num(Math.max(...series)),
    ];
  });
  out.push(...columns(['Agent', 'Trend', 'First', 'Last', 'Min', 'Max'], rows, c.dim));
  if (history.analyzed < history.requested) {
    out.push(
      '',
      c.dim(
        history.shallow
          ? `  Only ${history.analyzed} of ${history.requested} commits are available: this is a shallow clone.`
          : `  Only ${history.analyzed} of ${history.requested} commits exist on this branch.`,
      ),
    );
  }
  out.push('', c.dim('  Tokens are estimates. Only commits are analyzed, not the working tree.'));
  return `${out.join('\n')}\n`;
}
