import path from 'node:path';
import { isInside, readText } from './fs.ts';

// `@path` imports, shared by Claude Code (max 4 hops) and Gemini CLI (max 5).
// Claude: https://code.claude.com/docs/en/memory.md#import-additional-files

export interface ImportedFile {
  abs: string;
  text: string;
  /** Absolute path of the file that imported this one. */
  importedFrom: string;
  /** 1 for a direct import of the root file. */
  depth: number;
}

export interface ImportResult {
  files: ImportedFile[];
  /** Imports skipped because they are deeper than maxDepth. */
  tooDeep: { abs: string; importedFrom: string }[];
  warnings: { abs: string; message: string }[];
}

export interface ImportOptions {
  maxDepth: number;
  /** Needed to resolve `@~/...`; without it those imports are skipped. */
  home?: string;
  /** Files already loaded; shared across calls so nothing loads twice. */
  seen?: Set<string>;
  /**
   * Imports resolving outside this directory are skipped with a warning. Set to the repo
   * root unless --include-user, so output never depends on files outside the repo.
   */
  boundary?: string;
}

/** Import targets in document order, ignoring code spans and fenced code blocks. */
export function findImports(text: string): string[] {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === undefined) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const prose = line.replace(/(`+)[^`]*?\1/g, ' ');
    for (const match of prose.matchAll(/(?:^|\s)@((?:\\ |[^\s])+)/g)) {
      const target = (match[1] ?? '').replace(/\\ /g, ' ');
      // A quoted path is not an import.
      if (target.startsWith('"') || target.startsWith("'")) continue;
      out.push(target);
    }
  }
  return out;
}

function looksLikePath(target: string): boolean {
  return target.includes('/') || /\.[A-Za-z0-9]+$/.test(target);
}

/** Recursively expands the imports of one file, depth-first in document order. */
export function expandImports(abs: string, text: string, opts: ImportOptions): ImportResult {
  const result: ImportResult = { files: [], tooDeep: [], warnings: [] };
  const seen = opts.seen ?? new Set<string>();
  seen.add(path.resolve(abs));

  const visit = (from: string, content: string, depth: number): void => {
    for (const target of findImports(content)) {
      let resolved: string;
      if (target.startsWith('~/')) {
        if (!opts.home) continue;
        resolved = path.join(opts.home, ...target.slice(2).split('/'));
      } else {
        // path.resolve accepts "/" on every OS and keeps absolute targets absolute.
        resolved = path.resolve(path.dirname(from), target);
      }
      if (seen.has(resolved)) continue;
      if (opts.boundary !== undefined && !isInside(opts.boundary, resolved)) {
        result.warnings.push({
          abs: from,
          message: `import outside the repo not counted: @${target} (use --include-user)`,
        });
        continue;
      }
      if (depth + 1 > opts.maxDepth) {
        result.tooDeep.push({ abs: resolved, importedFrom: from });
        continue;
      }
      const imported = readText(resolved);
      if (imported === undefined) {
        if (looksLikePath(target)) {
          result.warnings.push({ abs: from, message: `import not found: @${target}` });
        }
        continue;
      }
      seen.add(resolved);
      result.files.push({ abs: resolved, text: imported, importedFrom: from, depth: depth + 1 });
      visit(resolved, imported, depth + 1);
    }
  };

  visit(abs, text, 0);
  return result;
}
