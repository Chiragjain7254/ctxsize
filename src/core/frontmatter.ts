import { parse } from 'yaml';

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
  /** Set when the frontmatter block exists but is not valid YAML. */
  error?: string;
}

const BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export interface FrontmatterOptions {
  /**
   * Fall back to plain `key: value` lines when the block is not valid YAML. Cursor's and
   * Copilot's docs show unquoted globs such as `globs: *.tsx`, which YAML reads as an
   * alias and rejects, yet those tools accept them. Claude Code does not: a skill with
   * broken YAML loads with empty metadata, so its loader keeps this off.
   */
  lenient?: boolean;
}

/** Splits YAML frontmatter from a Markdown file. Never throws. */
export function parseFrontmatter(text: string, opts: FrontmatterOptions = {}): Frontmatter {
  const match = BLOCK.exec(text);
  if (!match) return { data: {}, body: text };
  const body = text.slice(match[0].length);
  const block = match[1] ?? '';
  try {
    const data: unknown = parse(block);
    if (data === null || data === undefined) return { data: {}, body };
    if (typeof data !== 'object' || Array.isArray(data)) {
      return { data: {}, body, error: 'frontmatter is not a YAML mapping' };
    }
    return { data: data as Record<string, unknown>, body };
  } catch (err) {
    if (opts.lenient) {
      const data = parseLines(block);
      if (Object.keys(data).length > 0) return { data, body };
    }
    const reason = (err as Error).message.split('\n')[0];
    return { data: {}, body, error: `invalid YAML frontmatter: ${reason}` };
  }
}

/** `key: value` per line, values taken literally; quotes stripped, true/false as booleans. */
function parseLines(block: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*)[ \t]*:[ \t]*(.*?)[ \t]*$/.exec(line);
    if (!m?.[1]) continue;
    const raw = m[2] ?? '';
    const unquoted = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
    data[m[1]] = unquoted === 'true' ? true : unquoted === 'false' ? false : unquoted;
  }
  return data;
}

/** Reads a frontmatter field as a string; arrays are joined with ", " (globs, applyTo). */
export function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export function boolField(data: Record<string, unknown>, key: string): boolean {
  const value = data[key];
  return value === true || value === 'true';
}
