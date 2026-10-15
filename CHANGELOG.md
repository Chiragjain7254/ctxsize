# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] - 2026-10-16

### Changed
- Token counts are cached by content hash, so `--watch` and `--serve` do not re-tokenize files that did not change.
- Errors in `ctxsize.json` are more specific: they say what was found (`got "80" (a string)`), suggest the closest key for a typo, and give the line and column of invalid JSON.
- Tools that load 0 startup and 0 on-demand tokens are hidden by default. One line after the table
  names them (`Hidden: Aider, Zed (no files found) — use --all to show`), and `--json` has a `hidden`
  array of their ids. `--agents` always shows the tools it lists.

### Fixed
- Removed the internal progress log and other leftover files from the repository.
- An output file that cannot be written (`--html --out`, `--card`, `--badge`, `--markdown` in a missing or non-file path) now exits 2 with `ctxsize: cannot write <file>: <reason>` instead of printing a stack trace.
- `--history 1` (and a shallow clone with one commit) says "at the last commit" instead of "over the last 1 commits".

### Added
- A feedback issue template and a feedback Discussion, and a "Try it and tell us" section in the README.
- A "Good first issues" section in `CONTRIBUTING.md` with five small ideas taken from the code.
- Tests for CRLF line endings and Windows-style paths in instruction files, frontmatter, imports, `.gitignore` and `ctxsize.json`.
- The `--serve` page shows a short toast when files change and the report refreshes.
- The `--serve` and `--watch --html` page shows a live or disconnected status dot and the time the report last changed.
- A release workflow (`.github/workflows/release.yml`) that publishes to npm with provenance when a `v*` tag is pushed. It needs an `NPM_TOKEN` secret; without one, or when the version is already on npm, it skips the publish with a notice instead of failing. See `docs/RELEASING.md`.
- A composite GitHub Action (`uses: Chiragjain7254/ctxsize@v0.2.0`) with inputs `agents`, `max-tokens`, `max-percent`, `fail-on-warnings`, `directory`, `version` and `node-version`. By default it runs the ctxsize version that matches the action's own release, never a moving `latest`; set `version` to override. See `docs/CI.md`.
- `docs/CI.md`: GitHub Actions workflows with `--max-tokens` and a `--markdown` pull request comment, checked by a test.
- Exit codes are documented in full in `docs/CLI.md`, with a test for each code and reason.
- A JSON Schema for `ctxsize.json` (`schema/ctxsize.schema.json`, shipped in the npm package). `"$schema"` is accepted in the config, so editors can autocomplete and validate it.
- A JSON Schema for `--json` output: `docs/report.schema.json`, checked against real output in the tests.
- `--json` output has a `generatedAt` time next to `tool.version`. `SOURCE_DATE_EPOCH` pins it.
- `--fail-on-warnings` exits 1 when a `!` check fires (duplicates, skills with no description).
- Per-tool budgets: `tools.<id>.maxTokens` in `ctxsize.json` fails the run (exit 1) when that tool loads more at startup.
- `--max-percent <n>` is a CI gate: exit 1 when an agent uses more than n% of its context window at startup.
- `--exclude <glob>` (repeatable) and an `"exclude"` key in `ctxsize.json` leave files out of the scan.
- `--top <n>` sets how many biggest startup files are listed (terminal and `topFiles` in `--json`).
- `--sort <startup|name|cost>` orders the terminal agent and cost tables.
- `--quiet` prints one summary line plus gate failures and errors, for CI logs.
- A feature request issue template (a bug report template already existed).
- README badges: npm version, downloads, license and CI.
- `--serve` starts a local web server (`127.0.0.1`, port 4321, then the next 9) with the interactive
  report. It re-runs the analysis when files change and updates the open page over Server-Sent Events.
  `/api/report` returns the same JSON as `--json`. Add `--port <n>` to choose the port and `--no-open`
  to keep the browser closed.
- `--all` shows every tool, including those that load nothing.
- `--open` opens the `--html` report in the default browser. `--html` now also prints
  `Open it with: ctxsize --html --open`.

## [0.1.0] - 2026-10-13

First release.

### Added
- Built-in profiles for Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Cline,
  Windsurf, Aider and Zed. Every limit has its docs link and check date (`src/profiles.ts`).
- Your own tools in `ctxsize.json` (or a `"ctxsize"` key in `package.json`). See `docs/CONFIG.md`.
- Per-tool model with context window, tokenizer and input price (`--model`, `--context`, `--price`).
- Share of the context window, overhead over N messages (`--messages`), cost and biggest files.
- Truncation simulator: Codex 32 KiB and skill budgets, Claude skill listing and `MEMORY.md` limits,
  Cursor size advice, and the limits of the data-driven tools.
- Smart checks: duplicate instructions, suggestions to move big sections into skills, skill health.
- Interactive `--html` report: model, window, price and message controls, per-file what-if, drag to
  reorder, sort, search, dark mode.
- `--watch`, `--diff <ref>`, `--history <n>` (with `--html` chart) and `--tree`.
- `--mcp`: list configured MCP servers and, with the flag, start local ones to count tool tokens.
- `--markdown`, `--card` and `--badge`: a pull-request summary, an SVG card and a README badge.
- Terminal table, stable `--json` (`schemaVersion` 2), `--max-tokens` CI gate.
- A skills folder linked into two places is counted once.
- The walk skips folders that `.gitignore` ignores (and always `node_modules`, `dist`, `build`, `.git`).
- Token counts are marked as estimates (`~`) in the terminal, JSON (`tokensAreEstimates`) and HTML output.
- `--check-profiles`: every documented limit with its source URL and checked date.
