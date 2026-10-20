// A small .gitignore reader, enough to keep a walk out of big ignored folders.
// Supported: comments, blank lines, `!` negation, a trailing `/` (directories only), a
// leading or inner `/` (anchored to the .gitignore's folder), `*`, `?` and `**`.
// Not supported: `[abc]` classes and escapes. Last matching rule wins.

import { globToRegExp } from './glob.ts';

interface Rule {
  negate: boolean;
  dirOnly: boolean;
  /** True when the pattern has a slash, so it matches the path from the .gitignore folder. */
  anchored: boolean;
  re: RegExp;
}

export interface Ignore {
  /** True when the path (POSIX, relative to the .gitignore's folder) is ignored. */
  ignores(rel: string, isDir: boolean): boolean | undefined;
}

/** Parses the text of a .gitignore (LF or CRLF) into an `Ignore` that answers per path. */
export function parseGitignore(text: string): Ignore {
  const rules: Rule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trimEnd();
    if (line === '' || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    if (line === '') continue;
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    rules.push({ negate, dirOnly, anchored, re: globToRegExp(line) });
  }
  return {
    ignores(rel, isDir) {
      const base = rel.slice(rel.lastIndexOf('/') + 1);
      let result: boolean | undefined;
      for (const rule of rules) {
        if (rule.dirOnly && !isDir) continue;
        if (rule.re.test(rule.anchored ? rel : base)) result = !rule.negate;
      }
      return result;
    },
  };
}
