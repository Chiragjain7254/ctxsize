# ctxsize v0.1 plan

Written 2026-10-12. Target: a polished v0.1 in about 2 days, built as many small commits.

## Goal
One command, `npx ctxsize [dir]`, shows how many tokens each coding agent (Claude Code, Codex,
Cursor, Copilot, Gemini CLI) loads from a repo before the first prompt, and names exactly
which skills, files and bytes each agent will silently drop.

**For:** developers and maintainers who keep CLAUDE.md / AGENTS.md / rules / skills in a repo
and want to see, compare and gate their cost locally and in CI, without running any agent.

## Non-goals (v0.1)
- Running agents, calling any API, or any network access. Exact provider token counts (v0.2).
- MCP tool schemas (`--mcp`, v0.2), GitHub Action and PR comments (v0.2).
- `ctxsize diff a.json b.json`: **deferred to v0.2.** The Action defines the diff UX; shipping a
  diff format now would lock it twice. `--json` is stable and diffable with any tool meanwhile.
- The agents' own system prompts and built-in tools. We count *your files only*, and say so.
- Glob matching for conditional rules (Cursor `globs`, Copilot `applyTo`, Claude `paths:`):
  v0.1 lists them as on-demand with their globs; it does not guess which files you will open.
- Usage-aware drop order (Claude drops least-invoked skills first; we cannot know usage).
- Multiple Copilot surfaces: one default surface (cloud agent), noted in output.
- More agents (Windsurf, Cline, Aider, OpenCode, Amp): see FEATURES.md.

## Assumptions (decided; change only with a decisions.md entry)
1. **Tokenizer:** `js-tiktoken` `o200k_base`, labelled "estimate (o200k_base)" everywhere.
   Anthropic's tokenizer is not public; one tokenizer for all agents keeps numbers comparable.
2. **Reproducible by default:** without `--include-user` we never read the home dir or `/etc`,
   and ancestor walks stop at the repo root (nearest dir with `.git`, else `[dir]`).
   With `--include-user`, walks go to the filesystem root and user files are added (`~/...`).
3. **cwd = `[dir]`** (default `.`). Startup = what loads when the agent starts in that dir.
4. **Runtime deps:** `js-tiktoken`, `yaml` (frontmatter; skill descriptions use folded and
   multi-line YAML). CLI args via `node:util` `parseArgs`. No other runtime deps.
5. **Context window default:** 200,000 tokens for every agent, overridable with `--context`.
   Exception: Codex uses its documented 8,000-char skill budget unless `--context` is given.
6. **Claude skill budget:** 1% of context in tokens; if `SLASH_COMMAND_TOOL_CHAR_BUDGET` is set,
   that many chars. Over budget, we report "K of N descriptions will be dropped" and mark
   every skill description `at-risk` (usage unknown); names are always listed.
7. **Codex 32 KiB:** files are read root to cwd; budget counts file bytes only (not the
   separators); the file that crosses 32 KiB is cut at the limit, later files are dropped. Skill omission order: from the end of
   discovery order (issue #19090 says it is deterministic). Both are `will` drops.
8. **Copilot surface:** cloud agent (copilot-instructions.md, nearest AGENTS.md, root CLAUDE.md
   and GEMINI.md; `excludeAgent: cloud-agent` files are `ignored`).

## Resolved questions (checked in source, 2026-10-12)
- Q1: Codex 32 KiB: the crossing file is **cut** at the remaining bytes, later files are not
  read. Separators do not count toward the budget; whitespace-only files are skipped.
  Source: `codex-rs/core/src/agents_md.rs` @ 50d77959 (`data.truncate(remaining)`).
- Q2: Gemini `@import` max depth is **5** (`maxDepth: 5`). Source:
  `packages/core/src/utils/memoryImportProcessor.ts` @ ff00dacd in google-gemini/gemini-cli.
- Q3: Demo repo: a pinned commit of a well-known public repo with files for at least 3 agents,
  cloned to a temp dir, never vendored (owner's brief asks for exactly this).

## Architecture
```
src/cli.ts              parseArgs, run, exit codes (0 ok, 1 over --max-tokens, 2 usage/error)
src/core/types.ts       the contract below (M1, frozen after M1)
src/core/tokenize.ts    countTokens(text) with lazy o200k_base load
src/core/fs.ts          readText, exists (exact-case via readdir), ancestors, walk, toPosixRel
src/core/frontmatter.ts parse YAML frontmatter, CRLF-safe; body + data + error
src/core/imports.ts     expand @path imports (shared by Claude and Gemini)
src/core/analyze.ts     analyze(opts): run loaders, simulate, build Report
src/profiles.ts         every limit + source URL + checked date (M1, complete)
src/agents/index.ts     registry of all five loaders (M1, never edited by M2)
src/agents/{claude,codex,cursor,copilot,gemini}.ts   one loader each (M2)
src/simulate.ts         truncation simulator (M3)
src/report/{terminal,json,html}.ts                   output (M4, M5)
test/helpers.ts         tmpRepo(files), fixturePath(name), fakeHome(files)
test/fixtures/<agent>/<case>/   tiny fake repos (LF only via .gitattributes)
```

### Core contract (`src/core/types.ts`)
```ts
export type AgentId = 'claude' | 'codex' | 'cursor' | 'copilot' | 'gemini';
export type Category = 'instructions' | 'rules' | 'skills' | 'memory';
export type Load = 'startup' | 'on-demand' | 'ignored';

export interface LoadedItem {
  agent: AgentId;
  path: string;            // POSIX, relative to root; user files start with "~/"
  scope: 'project' | 'user';
  category: Category;
  load: Load;
  reason: string;          // "CLAUDE.md in ancestor", "globs: src/**/*.ts", "legacy, not documented"
  text: string;            // exactly what the agent would inject (skill: the listing entry)
  bytes: number;           // UTF-8 bytes of text
  tokens: number;          // estimate, filled by analyze() via countTokens
  importedFrom?: string;   // path of the file whose @import pulled this in
  order: number;           // load order within agent; simulator relies on it
  skill?: { name: string; description: string; whenToUse?: string; bodyPath: string };
}

export interface Warning { agent?: AgentId; path?: string; message: string }

export interface LoaderContext {
  root: string;            // absolute repo root
  cwd: string;             // absolute [dir]
  home?: string;           // set only with --include-user (tests pass a fake home)
  env: Record<string, string | undefined>;
  contextTokens?: number;  // from --context
}
export interface LoaderResult { items: Omit<LoadedItem, 'tokens'>[]; warnings: Warning[] }
export type Loader = (ctx: LoaderContext) => Promise<LoaderResult>;

export type DropKind =
  | 'file-truncated' | 'file-dropped' | 'import-too-deep'
  | 'skill-description-truncated' | 'skill-description-dropped' | 'skill-omitted'
  | 'over-recommended-size' | 'legacy';
export interface Drop {
  agent: AgentId; kind: DropKind; certainty: 'will' | 'at-risk' | 'advice';
  path?: string; skill?: string;
  bytesLost?: number; tokensLost?: number;
  limit: string;           // profile key, e.g. "codex.projectDocMaxBytes"
}

export interface AgentReport {
  agent: AgentId; label: string; contextTokens: number; notes: string[];
  startup: { total: number; byCategory: Record<Category, number> };   // after drops
  onDemand: { total: number; count: number };
  items: LoadedItem[]; drops: Drop[]; warnings: Warning[];
}
export interface Report {
  schemaVersion: 1; tool: { name: 'ctxsize'; version: string };
  tokenizer: 'o200k_base (estimate)'; root: string;   // root printed as "."
  agents: AgentReport[];                               // no timestamps: output is reproducible
}
```

### Profiles (`src/profiles.ts`)
One typed object per agent: `{ label, sources: { url, checked: '2026-10-12' }[], defaultContextTokens, ...limits }`.
Values: Claude `importMaxDepth: 4`, `skillListingBudgetFraction: 0.01`,
`skillListingMaxDescChars: 1536`, `memoryMaxLines: 200`, `memoryMaxBytes: 25_600`;
Codex `projectDocMaxBytes: 32_768`, `skillListingBudgetFraction: 0.02`,
`skillListingFallbackChars: 8000`; Cursor `ruleRecommendedMaxLines: 500`;
Copilot `surface: 'cloud-agent'`; Gemini `defaultFileNames: ['GEMINI.md']`, `importMaxDepth: 5`.
Sources: code.claude.com/docs/en/memory.md, /skills.md; learn.chatgpt.com/docs/agent-configuration/agents-md,
/docs/build-skills; cursor.com/docs/context/rules; docs.github.com custom-instructions (2 pages);
geminicli.com/docs/cli/gemini-md/, /skills/. Every behaviour comment in a loader cites a profile key.

## Milestones
Each is one focused session and several small commits. `npm run check` passes after every commit.

### M1. Core contract, tokenizer, profiles, fixture helpers (sequential, blocks M2)
Commits: types; tokenize; fs utils; frontmatter; imports; profiles; registry with five stub
loaders returning `{ items: [], warnings: [] }`; analyze() skeleton; test helpers.
Success checks:
- `countTokens('hello world')` equals a known o200k value; empty string is 0; tokenizer loads once.
- `toPosixRel('C:\\r', 'C:\\r\\a\\CLAUDE.md') === 'a/CLAUDE.md'` (path.win32 in test, all OS).
- `ancestors()` stops at the repo root by default; with include-user it ends at `C:\` (win32)
  and `/` (posix) without looping.
- `exists('claude.md')` is false when only `CLAUDE.md` exists (case-insensitive FS on Win/mac).
- frontmatter: CRLF file parses; folded `>` description; no frontmatter gives `{}`; bad YAML
  gives a warning, not a throw.
- imports: relative to importing file; max depth is a parameter (Claude 4, Gemini 5); a chain
  one deeper than the max stops with `import-too-deep`;
  `@x` inside inline code and fenced blocks is ignored; `@my\ file.md` resolves to
  `my file.md` on every OS; cycles stop; missing file is a warning; `@~/x` without home is skipped.
- every profile entry has at least one `https://` source and `checked` date (test enforces).
- `tmpRepo({...})` writes files and cleans up; `fakeHome` is never the real home (test asserts).

### M2. Five loaders (parallel: one subagent per agent, each in its own git worktree)
**Ownership rule:** each loader touches only `src/agents/<agent>.ts`,
`test/agents/<agent>.test.ts` and `test/fixtures/<agent>/`. No edits to core, profiles or the
registry; if a change is needed, note it in the PR and the coordinator lands it first.
Loaders emit items in load order and set `load`; they do NOT apply limits (M3 does).
Merge order does not matter; each PR must pass `npm run check` on all 6 CI jobs.
- **claude:** CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md in cwd+ancestors; `.claude/rules/**/*.md`
  (`paths:` gives on-demand); @imports; AGENTS.md / .claude/AGENTS.md only if no CLAUDE-family
  file in cwd or above; subdir CLAUDE.md on-demand; skills `.claude/skills/*/SKILL.md` (entry =
  name + description + when_to_use); user: ~/.claude/CLAUDE.md, ~/.claude/skills, MEMORY.md.
  Checks: AGENTS.md ignored when CLAUDE.local.md exists in an ancestor and used when none;
  nested `rules/a/b/x.md` found; rule with `paths:` is on-demand; subdir file on-demand;
  import from `.claude/rules/x.md` resolves relative to that file; Windows-style
  `docs\guide.md` path in fixture tree prints as `docs/guide.md`.
- **codex:** per dir root to cwd, first of AGENTS.override.md, AGENTS.md, fallback names
  (from `.codex/config.toml` `project_doc_fallback_filenames` only with include-user, else
  defaults); empty files skipped; skills from cwd/.agents/skills, parents, root, user dirs.
  Checks: override beats AGENTS.md in the same dir; only one file per dir; order root to cwd;
  empty file absent; `[dir]` below root picks up root and intermediate files.
- **cursor:** `.cursor/rules/**/*.mdc` only (`.md` there gives `ignored`); alwaysApply gives
  startup (globs ignored); globs or description gives on-demand; none gives on-demand (manual);
  root AGENTS.md startup, nested on-demand; `.cursorrules` emits `legacy`.
  Checks: one fixture per frontmatter mode; `.md` ignored; comma-separated globs kept in reason.
- **copilot:** `.github/copilot-instructions.md` startup; `.github/instructions/**/*.instructions.md`
  on-demand with applyTo; `excludeAgent: cloud-agent` gives ignored; nearest AGENTS.md; root
  CLAUDE.md and GEMINI.md. Checks: each case above; note about the modelled surface present.
- **gemini:** GEMINI.md (or `context.fileName`, string or array, from `.gemini/settings.json`)
  in cwd+ancestors; subdirs on-demand; @imports; skills `.gemini/skills`, `.agents/skills`
  (name + description). Checks: settings with `["AGENTS.md","GEMINI.md"]` loads both; imports
  expand; subdir file is on-demand; user dirs read only with fake home.

### M3. Truncation simulator (`src/simulate.ts`)
`simulate(agent, items, profile, contextTokens, env) => { items, drops }`, pure function.
Success checks (unit tests on hand-built items, no FS):
- Codex: 20 KiB + 20 KiB gives second file `file-truncated` with `bytesLost` 7,168; a third file
  gives `file-dropped`; startup total equals tokens of kept text.
- Codex skills over 8,000 chars: descriptions shortened first; still over gives `skill-omitted`
  naming the last skills in discovery order; under budget gives no drops.
- Claude: a 2,000-char description gives `skill-description-truncated` (464 chars lost);
  listing over 1% gives `at-risk` on every description plus the "K of N" note; names never dropped;
  `SLASH_COMMAND_TOOL_CHAR_BUDGET=500` switches to chars.
- Claude MEMORY.md: 300 lines gives 100 lines lost; 30 KB file is cut at 25 KB.
- Cursor: 600-line rule gives `over-recommended-size` with certainty `advice` (kept in total).
- `--context 100000` halves the Claude budget (test with a fixture right at the edge).

### M4. Terminal and JSON output, CLI wiring
Flags: `[dir]`, `--agents claude,codex`, `--context <n>`, `--include-user`, `--json`,
`--html [file]`, `--max-tokens <n>`, `--version`, `--help`.
Terminal: one table, rows = agents, columns = instructions / rules / skills / memory / startup
total / on-demand; then "Dropped / at risk" per agent (kind, path or skill, bytes and tokens lost);
footer "Token counts are estimates (o200k_base). Your files only." Colors only when TTY and no `NO_COLOR`.
Success checks:
- JSON for a fixture matches a committed snapshot, byte-identical on all 3 OSes (paths POSIX,
  root ".", no timestamps, no absolute paths).
- `--agents codex,cursor` gives only those two; unknown agent gives exit 2 with a message.
- `--max-tokens 100` on a fixture over budget gives exit 1 naming the agent; under gives 0.
- Bad `--context abc` gives exit 2. Empty repo: table of zeros, exit 0, no crash.
- `node dist/cli.mjs test/fixtures/...` (built bundle) works in CI on Windows; dir given as
  `.\sub` and `sub\` on win32 is resolved correctly.
- Terminal output snapshot with color off; width fits 100 columns.

### M5. HTML treemap (`--html [file]`, default `ctxsize-report.html`)
Squarified treemap computed in TypeScript and rendered to inline SVG at build time; one tab per
agent; tooltip via a few lines of inline JS; dropped items hatched; same data embedded as JSON.
Success checks:
- Output has no `http`/`https` URLs in `src`/`href` and no external fetch (regex test).
- Treemap rects tile the area: sum of rect areas within 0.1% of total; no rect with negative size.
- HTML for the fixture is under 200 KB; text content is escaped (`<script>` in a file name is inert).
- Opens and renders in a browser (manual check, screenshot saved for README).

### M6. Demo and README
- Pick a well-known public repo with files for at least 3 agents (Q3); pin the commit SHA.
- Run `ctxsize`, `--json`, `--html`; put the table and treemap screenshot in README with the SHA.
- README: one-line pitch, install-free usage, sample output, what is counted and what is not,
  "estimates" note, per-agent rules with links to profiles.ts, CI budget-gate example, FAQ.
Success checks: every README command copy-pasted runs as shown; demo run under 3 s; a newcomer
can go from README to first output in under a minute; `npm run check` green.

### M7. Release prep (owner approves anything public)
- Version 0.1.0, CHANGELOG entry, `files`/`bin` check, `npm pack --dry-run` lists only dist,
  README, LICENSE; bundle size noted.
- CI job: `npm pack`, then `npx ./ctxsize-0.1.0.tgz test/fixtures/...` on all 3 OSes, Node 22/24.
- Re-verify every profile source URL and bump `checked` dates; log in decisions.md.
- Hand off to the release skill; journal note with the demo numbers.
Success checks: packed tarball runs on all 6 CI jobs; `ctxsize --version` prints 0.1.0;
no network calls (test runs with network disabled env flag where possible).

## Risks
- **Limits change often.** All limits live in profiles.ts with URL and date; re-check at M7.
- **Undocumented behaviour** (Codex cut point, Claude drop order, Gemini depth): stated as
  assumptions in output notes and here; flagged `at-risk` rather than `will` when unsure.
- **Estimates differ from real counts** (Anthropic tokenizer is private): label everywhere;
  exact counts in v0.2.
- **Parallel loaders drifting from the contract:** contract frozen after M1; ownership rule;
  registry and profiles pre-filled; reviewer checks no PR touches files outside its loader.
- **Windows:** separators, drive roots, case-insensitive names, CRLF. Covered by M1 tests and the
  6-job CI matrix; fixtures LF via .gitattributes.
- **Tokenizer cost:** o200k ranks are large; lazy-load once; check bundle and startup time in M7.
- **Scope creep** (diff, MCP, Action, glob matching): parked in FEATURES.md for v0.2.
