# Press kit (drafts)

Copy for anyone writing about ctxsize. Everything here is checkable: the numbers have a source in the last section.
Tokens are estimates. Nothing here is a claim about how well your instructions are written.

## Ten taglines

1. See what your AI coding agent reads before you type, what it costs, and what it silently drops. *(the official one)*
2. A health grade for the files your coding agent reads.
3. Weigh your agent's luggage before the flight.
4. Which of your instruction files does your agent actually read?
5. Your CLAUDE.md, AGENTS.md and rules, weighed and graded.
6. The tokens your agent spends before it reads your first message.
7. Find the instruction file your agent quietly ignored.
8. One command. Ten agents. What each one loads, and what it drops.
9. Offline, no telemetry: a grade for your agent setup.
10. Stop guessing what your AI agent reads.

## One line

ctxsize is a free, offline command-line tool that shows what your AI coding agent reads before you type, what it costs, and what it silently drops, and grades it from A to F.

## One paragraph

ctxsize reads your repo and applies the documented rules of ten coding agents (Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Cline, Windsurf, Aider and Zed) to show which instruction files, rules and skills each one loads before your first message, how many tokens that is, and what gets cut off or ignored: a `CLAUDE.md` that hides your `AGENTS.md`, a file past a size limit, the same paragraphs loaded twice. It gives each agent and your repo a health grade from A to F, a short list of fixes, and a share card. It makes no network calls, sends nothing anywhere, never runs your agents, and labels every token count as an estimate. MIT licensed.

## Three paragraphs

**What it is.** ctxsize is a small Node command-line tool. Run `npx @chiragjain7254/ctxsize` in a repository and it prints what each coding agent loads before you type: instruction files like `CLAUDE.md` and `AGENTS.md`, rule folders, and skill listings, counted in estimated tokens. `--serve` opens a live report in the browser that updates as you edit your files, and a Cost calculator turns tokens into money using a price you enter (ctxsize has no prices of its own).

**Why it exists.** Agents follow different rules. With both an `AGENTS.md` and a `CLAUDE.md`, Claude Code reads only the `CLAUDE.md`; Codex stops adding `AGENTS.md` files at 32 KiB combined. Nothing tells you while you work, so instructions you wrote can quietly never arrive. The author, Chirag Jain, started it after a long-running Claude Code issue asking for `AGENTS.md` support (over 5,000 thumbs-up) and found no easy way to see what an agent really loads. Every limit in ctxsize is stored with a link to the agent's official documentation and the date it was checked, and a five-minute "secret fruit" test lets anyone compare ctxsize's prediction with the real agent.

**What you get.** A context health grade from A (nothing to fix) to F for every agent and overall, counted from the same list as the fix list; a share card (PNG or SVG) with the grade and the top three fixes; a README badge; a pre-commit hook, a VS Code task and a GitHub Action that fails a pull request when an agent's startup load grows past a budget. It runs on macOS, Windows and Linux with Node 22.12 or newer, never touches the network, and is open source under the MIT license.

## Key numbers

| Number | What it is | Source |
| --- | --- | --- |
| 10 | agents with a built-in profile | [`src/profiles.ts`](../../src/profiles.ts), [docs/tools.md](../tools.md) |
| 0 | network calls, accounts and telemetry events | [README](../../README.md#privacy); the code has no network access (see [SECURITY.md](../../SECURITY.md)) |
| A to F | grade; 15 points off per thing cut off, 5 per other thing to fix; cut off caps at C | [docs/GRADE.md](../GRADE.md) |
| 36% (18 of 50) | popular repos that ship both a CLAUDE.md and an AGENTS.md at the root | [docs/STUDY.md](../STUDY.md), ctxsize 0.2.0, 2026-10-16 |
| 6% (3 of 50) | repos with a file that at least one agent ignores (a symlinked CLAUDE.md does not count) | docs/STUDY.md |
| 0 of 50 | repos with a file or skill description an agent cuts under a documented limit (3 have something that may be cut, depending on use) | docs/STUDY.md |
| 1,429 / 7,514 | median / largest Claude Code startup load in the study, in estimated tokens | docs/STUDY.md |
| 32 KiB | Codex's combined AGENTS.md limit by default | [Codex docs](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [docs/WHY.md](../WHY.md) |
| 5,189 thumbs-up, 409 comments | Claude Code issue #6235 asking for AGENTS.md support (read 2026-10-16; closed August 2026) | [the issue](https://github.com/anthropics/claude-code/issues/6235), docs/WHY.md |

The 50 repos were picked because they are well known and active, not sampled, so the study numbers describe
those repos only. Token counts are estimates (o200k_base). Contact: [open an issue or a discussion](https://github.com/Chiragjain7254/ctxsize/discussions).
