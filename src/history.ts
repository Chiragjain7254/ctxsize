import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type AnalyzeOptions, analyze } from './core/analyze.ts';
import { globToRegExp } from './core/glob.ts';
import type { Report, ToolId } from './core/types.ts';
import type { Tool } from './tools.ts';

// Analyzing the past without touching the working tree: the files a commit holds that any
// tool might read are copied out of git's object store into a throwaway directory, and
// analyze() runs on that copy. Only read-only git plumbing is used (rev-parse, ls-tree,
// cat-file, log); nothing is checked out, stashed or written to .git.

/** Blobs larger than this are not read: no instruction file is that big. */
export const MAX_BLOB_BYTES = 1024 * 1024;
/** The most commits --history accepts. */
export const MAX_HISTORY = 200;
/** Files shown per tool in a diff. */
export const DIFF_FILES_SHOWN = 10;

export class HistoryError extends Error {}

export type SnapshotOptions = Omit<AnalyzeOptions, 'cwd'>;

// ---------------------------------------------------------------- result types
// Exported so the HTML report can chart them later.

export interface DiffFile {
  path: string;
  status: 'added' | 'removed' | 'changed';
  before: number;
  after: number;
  delta: number;
}

export interface ToolDiff {
  agent: ToolId;
  label: string;
  before: number;
  after: number;
  delta: number;
  /** null when the tool loaded nothing before. */
  deltaPct: number | null;
  overhead: {
    messages: number;
    beforeTokens: number;
    afterTokens: number;
    deltaTokens: number;
    beforeCostUsd: number | null;
    afterCostUsd: number | null;
    /** null when the model has no known price. */
    deltaCostUsd: number | null;
  };
  /** The files with the largest token change, biggest first (at most DIFF_FILES_SHOWN). */
  files: DiffFile[];
  /** How many files changed in total, including those not listed in `files`. */
  fileCounts: { added: number; removed: number; changed: number };
}

export interface DiffResult {
  base: { ref: string; commit: string };
  tools: ToolDiff[];
}

export interface HistoryEntry {
  commit: string;
  /** Committer date, ISO 8601. */
  date: string;
  subject: string;
  /** Startup tokens per tool id. */
  tools: Record<ToolId, number>;
}

export interface HistoryResult {
  requested: number;
  /** Commits actually analyzed (fewer than requested in a shallow or short history). */
  analyzed: number;
  /** True when the repository is a shallow clone that ran out of commits before `requested`. */
  shallow: boolean;
  /** Oldest first. */
  entries: HistoryEntry[];
}

// ---------------------------------------------------------------- git

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY']) {
    delete env[key];
  }
  return env;
}

/** Runs git with an argument array (never a shell string) and returns raw stdout. */
function git(cwd: string, args: string[], input?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd, encoding: 'buffer', maxBuffer: 1 << 30, windowsHide: true, env: gitEnv() },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reject(new HistoryError('git was not found on PATH'));
        }
        const first = stderr.toString('utf8').trim().split(/\r?\n/)[0] ?? '';
        reject(new HistoryError(first || err.message));
      },
    );
    if (input !== undefined) {
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    }
  });
}

const gitText = async (cwd: string, args: string[]) =>
  (await git(cwd, args)).toString('utf8').trim();

/** A ref must be a plain revision: no option lookalikes, no control characters. */
export function validateRef(ref: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  if (ref.trim() === '' || ref.startsWith('-') || /[\u0000-\u001f\u007f]/.test(ref)) {
    throw new HistoryError(`not a valid git ref: "${ref}"`);
  }
  return ref;
}

export interface Repo {
  /** Real path of the repository's top-level directory. */
  top: string;
  /** Where the analysis started, relative to `top` (OS separators; "" at the top). */
  sub: string;
}

/** The repository containing dir. Throws HistoryError when there is none. */
export async function openRepo(dir: string): Promise<Repo> {
  let top: string;
  try {
    top = await gitText(dir, ['rev-parse', '--show-toplevel']);
  } catch (err) {
    if (err instanceof HistoryError && err.message.includes('not found on PATH')) throw err;
    throw new HistoryError(`not a git repository: ${dir}`);
  }
  const realTop = realpathSync(path.resolve(top));
  return { top: realTop, sub: path.relative(realTop, realpathSync(dir)) };
}

/** Full commit id for a ref. */
export async function resolveCommit(repo: Repo, ref: string): Promise<string> {
  validateRef(ref);
  try {
    return await gitText(repo.top, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    throw new HistoryError(`unknown git ref: "${ref}" (not a commit in this repository)`);
  }
}

const isRegular = (mode: string | undefined) => mode === '100644' || mode === '100755';

/** path -> blob id of every regular file a commit holds. Symlinks and submodules are skipped. */
type Tree = Map<string, string>;

async function listTree(repo: Repo, rev: string): Promise<Tree> {
  const out = await git(repo.top, ['ls-tree', '-r', '-z', rev]);
  const files: Tree = new Map();
  for (const record of out.toString('utf8').split('\0')) {
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const [mode, type, sha] = record.slice(0, tab).split(' ');
    if (type === 'blob' && isRegular(mode) && sha) files.set(record.slice(tab + 1), sha);
  }
  return files;
}

/**
 * The tree of `to` given the tree of `from`: only the paths git reports as different are
 * touched, which is far cheaper than listing a big repository again.
 */
async function nextTree(repo: Repo, from: string, to: string, tree: Tree): Promise<Tree> {
  const out = await git(repo.top, ['diff-tree', '-r', '-z', '--no-renames', '--raw', from, to]);
  const next: Tree = new Map(tree);
  const tokens = out.toString('utf8').split('\0');
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const [, newMode, , newSha, status] = (tokens[i] ?? '').split(' ');
    const file = tokens[i + 1] ?? '';
    if (status !== 'D' && isRegular(newMode) && newSha) next.set(file, newSha);
    else next.delete(file);
  }
  return next;
}

/** Blob contents by id, read with one `git cat-file --batch` process per request. */
class BlobStore {
  private readonly blobs = new Map<string, Buffer>();
  /** Blobs that are too big or not blobs; not asked for again. */
  private readonly skipped = new Set<string>();
  private readonly repo: Repo;
  constructor(repo: Repo) {
    this.repo = repo;
  }

  async load(shas: Iterable<string>): Promise<void> {
    const wanted = [...new Set(shas)].filter((s) => !this.blobs.has(s) && !this.skipped.has(s));
    if (wanted.length === 0) return;
    // Sizes first, so a huge blob is never read.
    const sizes = (
      await git(this.repo.top, ['cat-file', '--batch-check'], `${wanted.join('\n')}\n`)
    )
      .toString('utf8')
      .split('\n');
    const small: string[] = [];
    wanted.forEach((sha, i) => {
      const [, type, size] = (sizes[i] ?? '').split(' ');
      if (type === 'blob' && Number(size) <= MAX_BLOB_BYTES) small.push(sha);
      else this.skipped.add(sha);
    });
    if (small.length === 0) return;
    const out = await git(this.repo.top, ['cat-file', '--batch'], `${small.join('\n')}\n`);
    let at = 0;
    for (const sha of small) {
      const eol = out.indexOf(0x0a, at);
      if (eol === -1) break;
      const size = Number(out.toString('utf8', at, eol).split(' ')[2]);
      at = eol + 1;
      this.blobs.set(sha, out.subarray(at, at + size));
      at += size + 1;
    }
  }

  get(sha: string): Buffer | undefined {
    return this.blobs.get(sha);
  }
}

// ---------------------------------------------------------------- which files matter

/** File names any tool reads, wherever they sit in the tree. */
const ALWAYS_NAMES = [
  'CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
  'AGENTS.override.md',
  'GEMINI.md',
  'CONVENTIONS.md',
  '.cursorrules',
  '.windsurfrules',
  'copilot-instructions.md',
];
/** Folders any tool reads, at any depth. */
const ALWAYS_DIRS = [
  '.claude',
  '.gemini',
  '.agents',
  '.cursor',
  '.codex',
  '.opencode',
  '.cline',
  '.clinerules',
  '.windsurf',
  '.devin',
  '.github/instructions',
];

/**
 * Says whether a repo-relative POSIX path might be read by one of the tools. Built from the
 * tools themselves (their instruction patterns, rule folders and skill folders), plus a
 * generous fixed list, so a tool defined in ctxsize.json is covered too. It over-selects on
 * purpose: a file read but unused costs time, a file missed gives a wrong number.
 * ctxsize.json and package.json are not needed: the config always comes from the current tree.
 */
export function candidateMatcher(tools: readonly Tool[]): (file: string) => boolean {
  const names = new Set(ALWAYS_NAMES);
  const dirs = new Set(ALWAYS_DIRS);
  const patterns = new Set<string>();
  const addDir = (dir: string) => {
    dirs.add(dir);
    const first = dir.split('/')[0] ?? '';
    if (first.startsWith('.') && first !== '.github') dirs.add(first);
  };
  for (const tool of tools) {
    const spec = tool.spec;
    if (!spec) continue;
    for (const pattern of spec.instructions ?? []) {
      if (/[*?{]/.test(pattern) || pattern.includes('/')) patterns.add(pattern);
      else names.add(pattern);
    }
    for (const rule of spec.rules ?? []) addDir(rule.dir);
    for (const dir of spec.skills?.dirs ?? []) addDir(dir);
  }
  const dirList = [...dirs];
  const patternList = [...patterns].map((p) => globToRegExp(p));
  // Consecutive commits share almost every path, so each path is judged once per run.
  const memo = new Map<string, boolean>();
  return (file) => {
    const known = memo.get(file);
    if (known !== undefined) return known;
    const answer = judge(file);
    memo.set(file, answer);
    return answer;
  };

  function judge(file: string): boolean {
    const segments = file.split('/');
    const base = segments[segments.length - 1] ?? '';
    if (segments.includes('node_modules') || segments.includes('.git')) return false;
    if (names.has(base)) return true;
    const wrapped = `/${file}`;
    if (dirList.some((d) => wrapped.includes(`/${d}/`))) return true;
    return patternList.some((re) => {
      for (let i = 0; i < segments.length; i++) {
        if (re.test(segments.slice(i).join('/'))) return true;
      }
      return false;
    });
  }
}

/** Targets of `@path` imports, close to what the Claude and Gemini loaders accept. */
function importTargets(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\s)@((?:\\ |[^\s])+)/g)) {
    const target = (m[1] ?? '').replace(/\\ /g, ' ');
    if (target.startsWith('"') || target.startsWith("'") || target.startsWith('~')) continue;
    if (target.includes('/') || /\.[A-Za-z0-9]+$/.test(target)) out.push(target);
  }
  return out;
}

const MAX_IMPORT_FILES = 2000;

interface Selection {
  /** path -> blob id of every file to copy out. */
  files: Map<string, string>;
  /** Equal signatures mean equal input for analyze(), so the result can be reused. */
  signature: string;
}

async function select(
  tree: Tree,
  isCandidate: (file: string) => boolean,
  store: BlobStore,
): Promise<Selection> {
  const files = new Map<string, string>();
  for (const [file, sha] of tree) if (isCandidate(file)) files.set(file, sha);
  await store.load(files.values());

  // Gemini's context.fileName can name any file, e.g. CONTEXT.md.
  const settings = files.get('.gemini/settings.json');
  const extra = settings ? geminiFileNames(store.get(settings)?.toString('utf8')) : [];
  if (extra.length > 0) {
    for (const [file, sha] of tree) {
      if (extra.includes(file.split('/').pop() ?? '')) files.set(file, sha);
    }
    await store.load(files.values());
  }

  // Files pulled in by @imports are read wherever they are.
  let frontier = [...files.keys()];
  for (let depth = 0; depth < 8 && frontier.length > 0 && files.size < MAX_IMPORT_FILES; depth++) {
    const next: string[] = [];
    for (const file of frontier) {
      const sha = files.get(file);
      const text = sha ? store.get(sha)?.toString('utf8') : undefined;
      if (!text?.includes('@')) continue;
      for (const target of importTargets(text)) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
        const found = tree.get(resolved);
        if (found && !files.has(resolved)) {
          files.set(resolved, found);
          next.push(resolved);
        }
      }
    }
    await store.load(next.map((f) => files.get(f) ?? ''));
    frontier = next;
  }

  const hash = createHash('sha1');
  for (const file of [...files.keys()].sort()) hash.update(`${file}\0${files.get(file)}\n`);
  return { files, signature: hash.digest('hex') };
}

function geminiFileNames(text: string | undefined): string[] {
  if (!text) return [];
  try {
    const value = (JSON.parse(text) as { context?: { fileName?: unknown } }).context?.fileName;
    const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
    return list.filter((n): n is string => typeof n === 'string' && n !== '');
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- analyzing a commit

function safeSegments(file: string): string[] | undefined {
  const parts = file.split('/');
  const bad = parts.some((p) => p === '' || p === '.' || p === '..' || p === '.git');
  return bad ? undefined : parts;
}

/** Copies the selection into a fresh temp dir (with a .git marker), runs fn there, deletes it. */
async function withSnapshot<T>(
  repo: Repo,
  selection: Selection,
  store: BlobStore,
  fn: (cwd: string) => Promise<T>,
): Promise<T> {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ctxsize-snap-')));
  try {
    mkdirSync(path.join(root, '.git'));
    for (const [file, sha] of selection.files) {
      const parts = safeSegments(file);
      const content = store.get(sha);
      if (!parts || !content) continue;
      const target = path.join(root, ...parts);
      try {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content);
      } catch {
        // A name this OS cannot store (reserved characters on Windows): skip it.
      }
    }
    const cwd = repo.sub === '' ? root : path.join(root, repo.sub);
    mkdirSync(cwd, { recursive: true });
    return await fn(cwd);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function analyzeCommit(
  repo: Repo,
  rev: string,
  opts: SnapshotOptions,
  isCandidate: (file: string) => boolean,
  store: BlobStore,
): Promise<{ report: Report; signature: string }> {
  const selection = await select(await listTree(repo, rev), isCandidate, store);
  const report = await withSnapshot(repo, selection, store, (cwd) => analyze({ ...opts, cwd }));
  return { report, signature: selection.signature };
}

// ---------------------------------------------------------------- --diff

/** Analyzes `ref` and compares it with `working`, the report of the current files. */
export async function computeDiff(
  repo: Repo,
  ref: string,
  working: Report,
  opts: SnapshotOptions,
  tools: readonly Tool[],
): Promise<DiffResult> {
  const commit = await resolveCommit(repo, ref);
  const { report: base } = await analyzeCommit(
    repo,
    commit,
    opts,
    candidateMatcher(tools),
    new BlobStore(repo),
  );
  return diffReports(base, working, { ref, commit });
}

/** Pure comparison of two reports (before, after) of the same tools. */
export function diffReports(
  before: Report,
  after: Report,
  baseInfo: { ref: string; commit: string },
): DiffResult {
  const tools: ToolDiff[] = [];
  for (const a of after.agents) {
    const b = before.agents.find((x) => x.agent === a.agent);
    const startup = (agent: typeof a | undefined) => {
      const map = new Map<string, number>();
      for (const item of agent?.items ?? []) {
        if (item.load === 'startup') map.set(item.path, (map.get(item.path) ?? 0) + item.tokens);
      }
      return map;
    };
    const was = startup(b);
    const now = startup(a);
    const files: DiffFile[] = [];
    for (const file of new Set([...was.keys(), ...now.keys()])) {
      const x = was.get(file) ?? 0;
      const y = now.get(file) ?? 0;
      if (x === y) continue;
      files.push({
        path: file,
        status: !was.has(file) ? 'added' : !now.has(file) ? 'removed' : 'changed',
        before: x,
        after: y,
        delta: y - x,
      });
    }
    files.sort(
      (p, q) =>
        Math.abs(q.delta) - Math.abs(p.delta) || (p.path < q.path ? -1 : p.path > q.path ? 1 : 0),
    );
    const fileCounts = { added: 0, removed: 0, changed: 0 };
    for (const f of files) fileCounts[f.status]++;

    const beforeTokens = b?.startup.total ?? 0;
    const afterTokens = a.startup.total;
    const beforeCost = b?.usage.overheadCostUsd ?? null;
    const afterCost = a.usage.overheadCostUsd;
    tools.push({
      agent: a.agent,
      label: a.label,
      before: beforeTokens,
      after: afterTokens,
      delta: afterTokens - beforeTokens,
      deltaPct:
        beforeTokens === 0
          ? null
          : Math.round(((afterTokens - beforeTokens) / beforeTokens) * 1000) / 10,
      overhead: {
        messages: a.usage.messages,
        beforeTokens: b?.usage.overheadTokens ?? 0,
        afterTokens: a.usage.overheadTokens,
        deltaTokens: a.usage.overheadTokens - (b?.usage.overheadTokens ?? 0),
        beforeCostUsd: beforeCost,
        afterCostUsd: afterCost,
        deltaCostUsd:
          beforeCost === null || afterCost === null
            ? null
            : Math.round((afterCost - beforeCost) * 1e6) / 1e6,
      },
      files: files.slice(0, DIFF_FILES_SHOWN),
      fileCounts,
    });
  }
  return { base: baseInfo, tools };
}

// ---------------------------------------------------------------- --history

/** Startup tokens per tool for the last `count` commits on HEAD's first-parent chain. */
export async function computeHistory(
  repo: Repo,
  count: number,
  opts: SnapshotOptions,
  tools: readonly Tool[],
): Promise<HistoryResult> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_HISTORY) {
    throw new HistoryError(`--history must be between 1 and ${MAX_HISTORY}`);
  }
  const empty: HistoryResult = { requested: count, analyzed: 0, shallow: false, entries: [] };
  try {
    await git(repo.top, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  } catch {
    return empty; // A repository with no commits yet.
  }

  const log = await git(repo.top, [
    'log',
    '--first-parent',
    '-z',
    `--max-count=${count}`,
    '--format=%H%x1f%cI%x1f%s',
    'HEAD',
  ]);
  const commits = log
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const [commit = '', date = '', subject = ''] = record.split('\x1f');
      return { commit: commit.trim(), date, subject };
    })
    .reverse();

  const isShallow = (await gitText(repo.top, ['rev-parse', '--is-shallow-repository'])) === 'true';
  const isCandidate = candidateMatcher(tools);
  const store = new BlobStore(repo);
  const entries: HistoryEntry[] = [];
  let previous: { signature: string; startup: Record<ToolId, number> } | undefined;

  let tree: Tree | undefined;
  let treeOf = '';
  for (const c of commits) {
    // The first commit lists the whole tree; the rest only apply what changed since.
    tree = tree ? await nextTree(repo, treeOf, c.commit, tree) : await listTree(repo, c.commit);
    treeOf = c.commit;
    const selection = await select(tree, isCandidate, store);
    let startup: Record<ToolId, number>;
    if (previous && previous.signature === selection.signature) {
      // No file any tool reads changed since the last commit: same answer.
      startup = previous.startup;
    } else {
      const report = await withSnapshot(repo, selection, store, (cwd) => analyze({ ...opts, cwd }));
      startup = Object.fromEntries(report.agents.map((a) => [a.agent, a.startup.total]));
    }
    previous = { signature: selection.signature, startup };
    entries.push({ commit: c.commit, date: c.date, subject: c.subject, tools: { ...startup } });
  }

  return {
    requested: count,
    analyzed: entries.length,
    shallow: isShallow && entries.length < count,
    entries,
  };
}

/** Report for the repository as it was at `rev`, with the same options as a normal run. */
export async function analyzeRevision(
  repo: Repo,
  rev: string,
  opts: SnapshotOptions,
  tools: readonly Tool[],
): Promise<Report> {
  const commit = await resolveCommit(repo, rev);
  const { report } = await analyzeCommit(
    repo,
    commit,
    opts,
    candidateMatcher(tools),
    new BlobStore(repo),
  );
  return report;
}
