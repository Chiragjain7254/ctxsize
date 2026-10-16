# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] - 2026-10-16

### Added
- **Context health grade (A to F)** for each agent and overall, counted from the same problems as the Fix list so the two cannot disagree (A means nothing to fix; anything cut off caps it at C). Shown on the Overview, in the terminal summary and table, in `--markdown` and in `--json` (`grade`). An agent that starts with 20% or more of its context window used now has a "startup load" problem in the Fix list. Rules: [docs/GRADE.md](docs/GRADE.md).

### Changed
- **Breaking change from 0.1.0: ctxsize no longer has built-in prices.** Prices change often and depend on your plan, so ctxsize never shows a price it chose itself. Cost appears only when you give a price: `--price <amount>`, with `--per <tokens>` (default `1m`; accepts `1000`, `1k`, `1m`) and `--currency <symbol or code>` (default `# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] - 2026-10-16

### Changed
- **Breaking change from 0.1.0: ctxsize no longer has built-in prices.** Prices change often and depend on your plan, so ctxsize never shows a price it chose itself. Cost appears only when you give a price: `--price <amount>`, with `--per <tokens>` (default `1m`; accepts `1000`, `1k`, `1m`) and `--currency <symbol or code>` , e.g. `₹` or `EUR`). Without `--price`, the terminal, Markdown, card and JSON show tokens only, and the terminal and Markdown add one hint line: `Add --price 3 --per 1m to see cost.` In JSON, `usage.overheadCostUsd` is now `usage.overheadCost` (in your currency, `null` without a price), the report has a top-level `price`, and `model.pricePer1MInput` is gone. A `pricePer1MInput` key in `ctxsize.json` is refused with a pointer to `--price`; the `--price` flag changed meaning (it was USD per 1M tokens replacing a model's price).
- Models carry only a context window and a tokenizer, and each window has the official page that states it and the date it was read (`sourceUrl`, `checkedDate`). I re-read every page on 2026-10-16: the windows of Claude Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5 (1M), GPT-6 Astra and Luna (1,050,000), GPT-5.3-Codex (400,000), Gemini 3.1 Pro Preview and 3.8 Flash (1,048,576) and DeepSeek V4 Pro (1M) are confirmed. Qwen3.8-Max's window is not stated on Alibaba Cloud's pages, so it is now unknown: reports say "unknown" and show no % of window for it (`--context` gives one).
- One tagline everywhere (README, `--help`, the npm description): "See what your AI coding agent reads before you type, what it costs, and what it silently drops."
- The HTML report is redesigned so the first screen is the answer. Five tabs: Overview, Agents, Fix list, Settings and Help. The Overview fits a 1366×768 screen with no scrolling: one verdict line ("Mostly fine — 1 file is cut off, and 5 things are worth fixing in all."), three tiles (who reads the most, what is cut off, what to fix), a bar chart with the agent, a bar, its tokens and a status icon (percent and cost are behind a "Show cost" switch) and the three most important fixes with the file and a "How to fix" line. The Fix list groups everything by file, worst first. Settings holds the "what if" controls, and Help holds the glossary, a five-line "How to read this page", the fine print, MCP servers and the share buttons, all folded away. No jargon on the Overview; the hard words stay in the hover help and in Help. An empty repo gets a friendly "No agent files found" with how to add one. The terminal and the page share one summary, so they always agree. Every term still has a hover help, defined once in `src/report/glossary.ts` and published as [docs/GLOSSARY.md](docs/GLOSSARY.md).
- Token counts are cached by content hash, so `--watch` and `--serve` do not re-tokenize files that did not change.
- Errors in `ctxsize.json` are more specific: they say what was found (`got "80" (a string)`), suggest the closest key for a typo, and give the line and column of invalid JSON.
- Tools that load 0 startup and 0 on-demand tokens are hidden by default. One line after the table
  names them (`Hidden: Aider, Zed (no files found) — use --all to show`), and `--json` has a `hidden`
  array of their ids. `--agents` always shows the tools it lists.

### Fixed
- The report no longer contradicts itself. Problems, each agent's status, the summary and the fine print now come from one list: an agent is marked "Fine" only when nothing is wrong with its files (a skill without a description is now attributed to every agent that loads it), a problem in a file you can fix (bad YAML, a missing `@import`) is a problem and not fine print, "Cheapest" says which agents it leaves out (those that read nothing), the counts are one total ("5 things to fix") instead of "4 more … and 1 more", and a percentage is written the same way everywhere (`<0.1%`, `0.4%`, `12%`).
- Removed the internal progress log and other leftover files from the repository.
- An output file that cannot be written (`--html --out`, `--card`, `--badge`, `--markdown` in a missing or non-file path) now exits 2 with `ctxsize: cannot write <file>: <reason>` instead of printing a stack trace.
- `--history 1` (and a shallow clone with one commit) says "at the last commit" instead of "over the last 1 commits".

### Added
- **How to save tokens.** Every fix and tip that really removes tokens says so: "Saves ~921 tokens per message" (a section that could be a skill, or text an agent loads twice). With a price entered it adds the money saved per day and per month in your currency. Each agent says what its own fixes save, and the Overview says "Fixing the top 3 items saves ~N tokens per message" when those items have a saving ctxsize can count. A fix it cannot count (an old file type, a missing description) claims nothing. The terminal shows the same lines.
- A **Cost calculator** tab in the HTML report (and a "See cost" button on the Overview). Type your own price: an amount, a currency (USD $, INR ₹, EUR €, GBP £ or your own text) and "per" 1K, 1M or a custom number of tokens, plus messages per day (default 50) and working days per month (default 22). It shows each agent's cost per message, per day and per month from ctxsize's token counts, cheapest first, with a worked example ("1,634 tokens × ₹250 / 1,000,000 = ₹0.41 per message"). An optional cheaper cached price with a "% of messages cached" lowers the cost, and "Compare another price" shows several labelled prices side by side and says which is cheaper for your repo (prices in different currencies are shown but not compared). Your inputs are remembered in your browser, and with no price it says "Enter your price to see cost" instead of showing zeros. A plain-words disclaimer sits above the results: real cost depends on caching and your plan, and on a monthly subscription you do not pay per token, so watch tokens instead.
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

- "Which agents do you use?": chips at the top of the Overview include or leave out each agent. The verdict, tiles, chart and Fix list count only the chosen agents. The choice (and "Show cost") is saved in `localStorage` (blocked storage is fine) and kept by a live `--serve` refresh, along with the tab you were on (it is in the address, e.g. `#fixes`).