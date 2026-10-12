import { parse } from 'yaml';

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
  /** Set when the frontmatter block exists but is not valid YAML. */
  error?: string;
}

const BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits YAML frontmatter from a Markdown file. Never throws. */
export function parseFrontmatter(text: string): Frontmatter {
  const match = BLOCK.exec(text);
  if (!match) return { data: {}, body: text };
  const body = text.slice(match[0].length);
  try {
    const data: unknown = parse(match[1] ?? '');
    if (data === null || data === undefined) return { data: {}, body };
    if (typeof data !== 'object' || Array.isArray(data)) {
      return { data: {}, body, error: 'frontmatter is not a YAML mapping' };
    }
    return { data: data as Record<string, unknown>, body };
  } catch (err) {
    return { data: {}, body, error: `invalid YAML frontmatter: ${(err as Error).message}` };
  }
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
