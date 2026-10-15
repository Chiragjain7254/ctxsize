# AGENTS.md

ctxsize is a Node CLI (TypeScript, ESM) that statically models what coding agents load at
startup and how many tokens it costs. It never runs agents and never touches the network.

## Commands
- `npm run check`: lint, typecheck, test, build. Must pass before every commit.
- `npm test`: Vitest. `npm run format`: Biome auto-fix.
- `npm run dev -- <dir>`: run from source.

## Layout
- `src/agents/<agent>.ts`: one loader per agent; each returns the files that agent loads.
- `src/profiles.ts`: every documented limit, with source URL and checked date. Never hard-code a limit elsewhere.
- `src/report/`: terminal, JSON and HTML output.
- `test/fixtures/`: tiny fake repos, one per behaviour under test.

## Rules
- Cross-platform: use `node:path`, and print POSIX-style relative paths; never assume `/` or `\`.
- Token counts are estimates; always label them so.
- A claim about how an agent behaves needs a link to its official docs in `src/profiles.ts`.
- Small commits, one logical change each.
- After every push, check GitHub CI passes (`gh run watch`). Never leave main red.
- Commit and push only project files. Temporary or local-only files go in `.local/` (git-ignored) and are never committed.

## Progress tracking
- Keep docs/PROGRESS.md with every outstanding task as a checkbox.
- A "Now working on: X of N" line at the top.
- Tick each box the moment it's done and commit it with the work.
- Also use the built-in todo list so it shows live.
- Never add Co-Authored-By, Claude-Session or "Generated with Claude Code" to any commit, PR or release.
