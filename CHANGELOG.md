# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/).

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
