import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { type Ignore, parseGitignore } from './gitignore.ts';
import { matchGlob } from './glob.ts';

type PathApi = typeof path.posix;

/** Relative POSIX path from root to target, e.g. "a/CLAUDE.md" on every OS. */
export function toPosixRel(root: string, target: string, p: PathApi = path): string {
  const rel = p.relative(root, target);
  return rel.split(p.sep).join('/') || '.';
}

/** True when target is root or inside it. */
export function isInside(root: string, target: string, p: PathApi = path): boolean {
  const rel = p.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
}

/** How a file is shown in output: relative to root, "~/..." under home, else absolute POSIX. */
export function displayPath(
  abs: string,
  ctx: { root: string; home?: string },
  p: PathApi = path,
): string {
  if (isInside(ctx.root, abs, p)) return toPosixRel(ctx.root, abs, p);
  if (ctx.home && isInside(ctx.home, abs, p)) return `~/${toPosixRel(ctx.home, abs, p)}`;
  return abs.split(p.sep).join('/');
}

/** Directories from start up to and including stop (or the filesystem root). */
export function ancestors(start: string, stop?: string, p: PathApi = path): string[] {
  const dirs: string[] = [];
  let dir = p.resolve(start);
  const end = stop === undefined ? undefined : p.resolve(stop);
  for (;;) {
    dirs.push(dir);
    if (end !== undefined && dir === end) break;
    const parent = p.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/** Nearest directory at or above start that contains .git (a dir or a worktree file). */
export function findRoot(start: string): string {
  for (const dir of ancestors(start)) {
    if (existsSync(path.join(dir, '.git'))) return dir;
  }
  return path.resolve(start);
}

/**
 * True only when a file named exactly `name` exists in dir. Agents match file names
 * case-sensitively, but Windows and macOS file systems do not, so plain existsSync lies.
 */
export function fileExists(dir: string, name: string): boolean {
  if (isExcluded(path.join(dir, name))) return false;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  if (!entries.includes(name)) return false;
  try {
    return statSync(path.join(dir, name)).isFile();
  } catch {
    return false;
  }
}

export function dirExists(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** File text without a UTF-8 BOM, or undefined if it cannot be read. */
export function readText(file: string): string | undefined {
  if (isExcluded(file)) return undefined;
  try {
    const text = readFileSync(file, 'utf8');
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return undefined;
  }
}

/** Put a file with this name in a folder to keep it out of walks that start above it. */
export const IGNORE_MARKER = '.ctxsizeignore';

/**
 * Directories no agent reads instructions from, skipped so a walk of a big repo stays
 * fast: VCS data, dependencies, build output, and agents' own worktree copies of the repo.
 */
const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.gradle',
]);

/** Folders agents read config from; a .gitignore never hides these from the walk. */
const AGENT_DIRS = new Set(['.claude', '.cursor', '.github', '.gemini', '.codex', '.agents']);

interface Scope {
  base: string;
  ignore: Ignore;
}

/** True when a .gitignore on the way down ignores this directory. */
function gitIgnored(scopes: Scope[], full: string): boolean {
  let result = false;
  for (const { base, ignore } of scopes) {
    const hit = ignore.ignores(toPosixRel(base, full), true);
    if (hit !== undefined) result = hit;
  }
  return result;
}

function skipDir(parent: string, name: string): boolean {
  if (SKIP_DIRS.has(name)) return true;
  // .claude/worktrees and similar hold full copies of the repo.
  if (name === 'worktrees' && path.basename(parent) === '.claude') return true;
  // A folder holding a .ctxsizeignore file (sample repos, test data) is left out of walks
  // that start above it. A walk that starts inside it still works.
  return existsSync(path.join(parent, name, IGNORE_MARKER));
}

export interface WalkOptions {
  /** Follow symlinked directories (Claude Code's .claude/rules allows them). Default false. */
  followSymlinks?: boolean;
  /** Skip directories that .gitignore files inside dir ignore. Default true. */
  gitignore?: boolean;
}

const walkCache = new Map<string, string[]>();

let exclusion: { root: string; patterns: string[] } = { root: '', patterns: [] };

/**
 * Files matching these globs (relative to root, "/" separators) do not exist as far as the agents'
 * loaders can tell. A pattern without a "/" matches that name at any depth; a pattern that names a
 * folder excludes everything inside it. Set once per analysis.
 */
export function setExcludes(root: string, patterns: readonly string[]): void {
  exclusion = { root: path.resolve(root), patterns: [...patterns] };
  walkCache.clear();
}

/** True when the file is left out by the exclude globs. */
export function isExcluded(abs: string): boolean {
  if (exclusion.patterns.length === 0 || !isInside(exclusion.root, abs)) return false;
  const rel = toPosixRel(exclusion.root, abs);
  const name = path.basename(abs);
  return exclusion.patterns.some(
    (p) =>
      matchGlob(p, rel) ||
      matchGlob(`${p.replace(/\/+$/, '')}/**`, rel) ||
      (!p.includes('/') && matchGlob(p, name)),
  );
}

/** Forget cached walks; analyze() calls this once per run so loaders share one walk. */
export function clearWalkCache(): void {
  walkCache.clear();
}

/** All files under dir, recursively, in stable code-point order. Cached per run. */
export function walkFiles(dir: string, opts: WalkOptions = {}): string[] {
  const useIgnore = opts.gitignore !== false;
  const key = `${opts.followSymlinks ? 'L' : 'P'}${useIgnore ? '' : 'N'}:${path.resolve(dir)}`;
  const cached = walkCache.get(key);
  if (cached) return cached;
  const ignored = (scopes: Scope[], _parent: string, name: string, full: string): boolean =>
    useIgnore && !AGENT_DIRS.has(name) && gitIgnored(scopes, full);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (current: string, outer: Scope[]): void => {
    // Symlinks are only followed on request, so only then can a walk loop back on itself.
    if (opts.followSymlinks) {
      const id = dirKey(current);
      if (id === undefined || seen.has(id)) return;
      seen.add(id);
    }
    let scopes = outer;
    if (useIgnore) {
      const text = readText(path.join(current, '.gitignore'));
      if (text !== undefined) scopes = [...outer, { base: current, ignore: parseGitignore(text) }];
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => compareCodePoints(a.name, b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isFile()) {
        out.push(full);
      } else if (entry.isDirectory()) {
        if (!skipDir(current, entry.name) && !ignored(scopes, current, entry.name, full))
          visit(full, scopes);
      } else if (entry.isSymbolicLink() && opts.followSymlinks) {
        try {
          const st = statSync(full);
          if (st.isFile()) out.push(full);
          else if (
            st.isDirectory() &&
            !skipDir(current, entry.name) &&
            !ignored(scopes, current, entry.name, full)
          )
            visit(full, scopes);
        } catch {
          // Broken link.
        }
      }
    }
  };
  visit(dir, []);
  const kept = out.filter((f) => !isExcluded(f));
  walkCache.set(key, kept);
  return kept;
}

/** Identity of a directory, so a symlink back to an ancestor is visited once. */
function dirKey(dir: string): string | undefined {
  try {
    const st = statSync(dir, { bigint: true });
    return st.isDirectory() ? `${st.dev}:${st.ino}` : undefined;
  } catch {
    return undefined;
  }
}

/** Locale-independent sort so output order is identical on every machine. */
export function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
