# Gap report: ctxsize (working name)

**Decision: BUILD (project 1).** Research date 2026-10-12. Re-verify agent limits before coding:
they change often.

## One line
One command shows what every coding agent (Claude Code, Codex, Cursor, Copilot, Gemini CLI)
loads before your first prompt, in tokens, and what each one silently drops.
Think "size-limit / bundlewatch, but for agent context".

## The problem, with evidence
- "Claude Code sends 33k tokens before reading the prompt":
  [HN, 706 points](https://news.ycombinator.com/item?id=48883275). The authors had to
  [build their own proxy](https://systima.ai/blog/claude-code-vs-opencode-token-overhead) to measure it.
- Claude Code context-bloat issues: [#7328](https://github.com/anthropics/claude-code/issues/7328)
  (225 reactions), [#7336](https://github.com/anthropics/claude-code/issues/7336) (109),
  [#14920](https://github.com/anthropics/claude-code/issues/14920) (95).
- Silent truncation:
  - Codex caps the skill listing at 2% of context; [#19679](https://github.com/openai/codex/issues/19679)
    (40 reactions) asks to make it configurable; [#19090](https://github.com/openai/codex/issues/19090)
    says it deterministically drops the same skills.
  - Claude Code drops skill descriptions past ~1% of context
    ([docs](https://code.claude.com/docs/en/skills.md)).
  - Codex ignores AGENTS.md past 32 KiB.
- No visibility: Cursor users ask for a way to see which rules are actually loaded
  ([forum](https://forum.cursor.com/t/cannot-see-full-list-of-active-rules-active-rules-is-either-wrong-or-rules-are-misapplied/156166)).
- MCP tool lists can cost ~100k+ tokens ([example](https://github.com/erikdarlingdata/PerformanceMonitor/issues/3898)).

## What exists
| Project | Stars | What it does | Gap |
| --- | --- | --- | --- |
| [agnix](https://github.com/agent-sh/agnix) | ~450 | 455-rule linter for agent config files | No token or budget features |
| [claude-devtools](https://github.com/matt1398/claude-devtools) | ~4k | Inspects Claude Code sessions after the fact | One agent, in-session, not diffable |
| [context-lens](https://github.com/larsderidder/context-lens) | ~400 | Proxy that visualizes the context window | Needs a live run |
| [driftlint](https://github.com/alifurkangokce/driftlint) | ~60 | Stale claims; size in characters | No tokens, no per-agent loading |
| [contextfloor](https://github.com/ar33s08/contextfloor) | 0 | Startup context per file, CI gate | Closest idea, no traction |
| Built-in: Claude `/context`, `codex doctor --json` | | One agent each, inside a session | Not cross-agent, not CI |

## Our edge
Cross-agent, static (no running agents, no API keys), diffable, and CI-native, with a truncation
simulator that names exactly what each agent will drop.

## v0.1 (target 1.5-2 days)
1. Per-agent static loaders: Claude Code (CLAUDE.md, `@imports`, AGENTS.md fallback, skills
   metadata), Codex (nested AGENTS.md, skills), Cursor (rules with alwaysApply/globs),
   Copilot (instructions + `applyTo`), Gemini CLI (GEMINI.md). Tokens per file and per category.
2. Truncation simulator from a versioned `profiles` file of each agent's documented limits;
   output names the skills/lines each agent will drop.
3. Output: terminal table, JSON, and a single-file HTML treemap (the shareable screenshot).
4. Works with one command in any repo on macOS, Windows and Linux.

## v0.2 (days 3-4)
5. `--mcp`: start configured MCP servers, call `tools/list`, count schema tokens.
6. GitHub Action: PR comment like "+1.2k tokens per Codex session; skill X now dropped by Claude Code",
   with an optional budget gate.
7. Optional exact counts via provider token-count APIs; default is a clearly labeled estimate.

## Risks
- Agent limits change: keep them in one profile file with sources and dates; this is also a
  steady source of meaningful commits.
- Anthropic's tokenizer isn't public: label estimates honestly; offer API-based exact counts.
- Agents' built-in tools may improve: our edge is cross-agent + CI + diff.

## Language suggestion
TypeScript/Node for `npx <name>` one-command use and an easy GitHub Action. Python with `uvx`
is fine if the planner prefers; decide and log it.
