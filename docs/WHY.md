# Why ctxsize exists

Coding agents read instruction files and skills before you type anything. Which files they read
differs by agent, changes between versions, and is cut off or skipped without a warning. Below are
the sources that show it. Every source was opened and read on **2026-10-15**; numbers are the ones
seen on that day, and a number that could not be confirmed is left out. The numbers for #6235, the two Codex issues, the Gemini CLI issue and the Hacker News post were read again on **2026-10-16**.

## Which file does my agent read?

- **[Feature Request: Support AGENTS.md. (anthropics/claude-code #6235)](https://github.com/anthropics/claude-code/issues/6235)**
  Opened 2025-08-21, closed as completed 2026-08-17. 5,189 thumbs-up (6,688 reactions in all) and
  409 comments, read from the GitHub API on 2026-10-15.
  > "Currently, if a developer using Claude Code clones a repository that provides an AGENTS.md file, that context is ignored."

  (The top comment, which holds this quote, has 672 thumbs-up.)
- **[Does Claude Code read AGENTS.md? (No — here's what actually works)](https://gist.github.com/yurukusa/d36197848911f025add142abefcde685)**
  A gist by yurukusa, updated 2026-06-03. It puts #6235 at "5,200+ reactions"; the API figure above
  (5,189 thumbs-up) agrees. The gist is out of date now that Claude Code reads AGENTS.md.
  > "Anthropic has not committed to native support."
- **[Claude Code doesn't read your AGENTS.md (makandra cards)](https://makandracards.com/makandra/626671-claude-code-read-agents-md)**
  Henning Koch, 2026-07-20. The card is now marked deprecated: from Claude Code 2.1.277 AGENTS.md is read directly.
  > "Create a `CLAUDE.md` at the repo root that imports your `AGENTS.md`"
- **[Claude Code now reads AGENTS.md if there is no Claude.md (Hacker News)](https://news.ycombinator.com/item?id=49760187)**
  741 points and 283 comments (Algolia HN API, 2026-10-16). It links the Claude Code changelog.
  One commenter on the old workaround: "I tried that before, it doesn't work."
- **[AGENTS.md silently not loaded (google-gemini/gemini-cli #28227)](https://github.com/google-gemini/gemini-cli/issues/28227)**
  Open, 2 comments, 0 reactions. Gemini CLI reads only `GEMINI.md` unless you set `context.fileName`.
  > "AGENTS.md silently not loaded — not in default context.fileName list in v0.49.0"

**How ctxsize helps:** `npx @chiragjain7254/ctxsize --all --json` lists every file each agent
sees as `startup`, `on-demand` or `ignored`, with the reason (for example `ignored: CLAUDE.md present`
for an `AGENTS.md` next to a `CLAUDE.md` in Claude Code). The terminal table shows what loads and
`--tree` shows it per starting folder; each rule comes from an official doc linked in `--check-profiles`.

## My instruction files waste tokens

- **[Official Claude Code memory docs](https://code.claude.com/docs/en/memory)**
  The docs target under 200 lines per CLAUDE.md file.
  > "Longer files consume more context and reduce adherence."
- **[Claude Code Token Waste: 9 Patterns Burning Your Budget (and the Fix) (2026)](https://vantaige.io/blog/claude-code-token-waste-9-patterns-fixes-2026)**
  Aymen B, published 2026-05-19, updated 2026-07-10. Its numbers are illustrative examples, as the
  article says itself, not measurements.
  > "A 4,800-token CLAUDE.md is not 4,800 tokens once; across a 120-turn session it is processed 120 times."
- **[The AGENTS.md Bloat Problem: When More Context Makes Agents Worse](https://codex.danielvaughan.com/2026/03/27/agents-md-bloat-problem/)**
  Daniel Vaughan, 2026-03-27. Cites a study where LLM-written files raised inference cost by "over 20%".
  > "Each line of your AGENTS.md is a commitment to extra agent steps."
- **[Your CLAUDE.md Is Probably Too Long (And That's Why It's Not Working)](https://tianpan.co/blog/2026/02/14/writing-effective-agent-instruction-files)**
  Tian Pan, 2026-02-14. Reports that files beyond 1,000 words showed negative correlation with agent performance.
  > "past a certain size, adding more instructions causes the model to follow fewer of them."

**How ctxsize helps:** `npx @chiragjain7254/ctxsize --agents claude` prints the startup tokens (add
`--price 3 --per 1m` with your own price to see the cost over 50 messages), and its Checks section flags
duplicate instructions.
`npx @chiragjain7254/ctxsize --max-tokens 8000` fails CI when an agent's startup load grows past a budget.

## Agents silently drop or ignore files

- **[long AGENTS.md truncated (openai/codex #43075)](https://github.com/openai/codex/issues/43075)**
  Open, 2 comments, 1 thumbs-up. Reported on codex-cli 0.153.4.
  > "Codex only got the first 37,089 bytes"
- **[Docs: project_doc_max_bytes documented as per-file on one page, cumulative on another (openai/codex #36371)](https://github.com/openai/codex/issues/36371)**
  Open, 0 comments. The reporter says the code is cumulative across the AGENTS.md chain.
  Related: [#37956](https://github.com/openai/codex/issues/37956), open, 1 comment, on which files get cut first.
- **[The AGENTS.md Bloat Problem](https://codex.danielvaughan.com/2026/03/27/agents-md-bloat-problem/)** (same post as above)
  > "Codex CLI silently truncates any AGENTS.md over 32 KiB without warning."

  The two Codex issues above say the 32 KiB limit is a combined limit, not per file.
- **[Claude Code reads AGENTS.md only when telemetry is on](https://blog.szypowi.cz/p/claude-code-reads-agents.md-only-when-telemetry-is-on/)**
  Przemek, 2026-09-23. On Hacker News: 486 points, 284 comments (Algolia HN API, 2026-10-15). Reported fixed.
  > "With telemetry or nonessential traffic turned off, a local AGENTS.md is skipped without a warning."
- **[Why does Cursor ignore rules?](https://forum.cursor.com/t/why-does-cursor-ignore-rules/137219)**
  Cursor forum, 2025-10-13. The page shows no view or like counts. A user says the agent follows rules
  only once they are mentioned; that is about a model following loaded rules, which ctxsize cannot see.
- **[.cursorrules isn't loaded in agent mode. I tested it, here's what actually works](https://forum.cursor.com/t/cursorrules-isnt-loaded-in-agent-mode-i-tested-it-heres-what-actually-works/152045)**
  2026-02-16. The author first measured 0 of 9 for `.cursorrules` against 9 of 9 for `.mdc`, then
  corrected it: "Both .cursorrules and .mdc files load in agent mode." A reminder that
  "it ignored my file" is often a different problem.

**How ctxsize helps:** `npx @chiragjain7254/ctxsize --agents codex` prints a "Dropped or at risk"
section: the file that crosses Codex's 32 KiB limit is marked cut and later files dropped, with the
tokens lost. Skill descriptions cut by a listing budget and legacy files such as `.cursorrules`
show up there too. ctxsize cannot see settings that switch a feature off at runtime, like the
telemetry case above, or whether a model obeys a rule it loaded. To check those on a real agent, use
the [secret-word test](VERIFY.md).

## Sources checked and left out

- Both Medium posts from the original list returned HTTP 403 and could not be read, so they are not
  cited: [My CLAUDE.md was eating 42,000 tokens per conversation](https://medium.com/@cem.karaca/my-claude-md-was-eating-42-000-tokens-per-conversation-heres-how-i-fixed-it-85ffba809bd4)
  and [Does Claude Code read your AGENTS.md? We checked 283 repos](https://medium.com/@decoding_ai_by_nureravi/does-claude-code-read-your-agents-md-we-checked-283-repos-in-161-it-still-reads-claude-md-cb6199708fc1).
- Morph's token-usage articles returned HTTP 429 (rate limited), so they are not cited.
- No Reddit thread could be found and opened, so none is cited.
