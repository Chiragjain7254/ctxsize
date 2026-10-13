# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Built-in profiles for OpenCode, Cline, Windsurf, Aider and Zed, each limit with its source and date.
- Your own tools in `ctxsize.json` (or a `"ctxsize"` key in `package.json`): instruction globs, rules
  and skills folders, limits. Merged with the built-ins. See `docs/CONFIG.md`.
- Models: pick one per tool (`--model`, or in `ctxsize.json`) with its context window, tokenizer
  (`o200k_base`, `cl100k_base`, or a chars-per-token ratio) and input price per 1M tokens.
- Share of the context window, overhead over N messages (`--messages`, default 50), estimated cost,
  biggest files and a side-by-side cost table in the terminal, JSON and HTML.
- Smart checks: duplicate instructions, suggestions to move big sections into skills, skill health.
- `--tree`: startup load when the agent starts in each nested folder.
- `--mcp`: list the MCP servers a repo configures and, with the flag, start local ones to count their
  tool tokens.
- `--markdown`, `--card` and `--badge`: a pull-request summary, an SVG summary card and a README badge.

### Changed
- JSON report `schemaVersion` is now 2: per-tool `model`, `usage` and `topFiles`, top-level
  `messages` and `checks`; the top-level `tokenizer` field is gone (each tool's model has one).
- Default context windows now come from each tool's model instead of a flat 200,000 tokens.

### Fixed
- A skills folder linked into two places (`.claude/skills` -> `.agents/skills`) is counted once.

## [0.1.0] - 2026-10-12

### Added
- Loaders for Claude Code, Codex, Cursor, GitHub Copilot (cloud agent) and Gemini CLI.
- Truncation simulator: Codex 32 KiB and skill budgets, Claude skill listing and MEMORY.md limits, Cursor size advice.
- Terminal table, stable `--json`, self-contained `--html` treemap, `--max-tokens` gate.
