// A small glob matcher for POSIX-style relative paths. Supported: `**` (any number of
// directories, including none), `*` and `?` (within one path segment), `{a,b}` alternatives.
// Matching is case-sensitive. Used for the instruction globs in tool specs.

const SPECIAL = /[.+^$()|[\]\\]/g;

/** Compiles a glob pattern to an anchored, case-sensitive RegExp. */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  let braces = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i] ?? '';
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '{') {
      braces++;
      out += '(?:';
    } else if (ch === '}' && braces > 0) {
      braces--;
      out += ')';
    } else if (ch === ',' && braces > 0) {
      out += '|';
    } else {
      out += ch.replace(SPECIAL, '\\$&');
    }
  }
  return new RegExp(`^${out}$`, 'u');
}

/** True when the whole POSIX-style relative path matches the glob. */
export function matchGlob(pattern: string, posixPath: string): boolean {
  return globToRegExp(pattern).test(posixPath);
}

/** True when the pattern has any of `*`, `?` or `{`, so it is not a plain file name. */
export function hasGlobChars(pattern: string): boolean {
  return /[*?{]/.test(pattern);
}
