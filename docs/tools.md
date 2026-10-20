# What each tool reads

ctxsize models what a tool loads **before your first prompt** ("startup") and what only loads later
("on demand"). Everything here comes from the tool's own documentation; each limit lives in
[`src/profiles.ts`](../src/profiles.ts) with its source URL and the date it was checked. Where the docs
are silent, ctxsize says so in the report's notes rather than guessing.

Add your own tool, or change one of these, in [`ctxsize.json`](CONFIG.md).

| Tool | Reads at startup | Limits modelled | Sources |
| --- | --- | --- | --- |
| Claude Code | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` (cwd and parents), `AGENTS.md` only when there is no `CLAUDE.md` or `CLAUDE.local.md` (otherwise it is ignored, unless a `CLAUDE.md` imports it), `.claude/rules/**` (rules with `paths:` are on demand), `@imports`, skill name + description entries, `MEMORY.md` | Skill listing budget (1% of the window), 1,536-char description cap, `MEMORY.md` 200 lines / 25 KB, import depth 4 | [memory](https://code.claude.com/docs/en/memory.md), [skills](https://code.claude.com/docs/en/skills.md) |
| Codex | One `AGENTS.override.md` or `AGENTS.md` per folder from the repo root to cwd, skill entries | 32 KiB for project docs (the crossing file is cut), skill listing budget | [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [skills](https://learn.chatgpt.com/docs/build-skills) |
| Cursor | `.cursor/rules/**/*.mdc` with `alwaysApply`, root `AGENTS.md` | 500 lines per rule (advice) | [rules](https://cursor.com/docs/context/rules) |
| GitHub Copilot (cloud agent) | `.github/copilot-instructions.md`, nearest `AGENTS.md`, root `CLAUDE.md` / `GEMINI.md` | none documented | [repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions), [support matrix](https://docs.github.com/en/copilot/reference/custom-instructions-support) |
| Gemini CLI | `GEMINI.md` (cwd and parents), `@imports`, skill entries | import depth 5 | [GEMINI.md](https://geminicli.com/docs/cli/gemini-md/), [skills](https://geminicli.com/docs/cli/skills/) |
| OpenCode | The nearest `AGENTS.md`, else `CLAUDE.md`; skill entries from `.opencode/skills`, `.claude/skills`, `.agents/skills` | skill description 1,024 chars (flagged) | [rules](https://opencode.ai/docs/rules/), [skills](https://opencode.ai/docs/skills/) |
| Cline | `.clinerules/*.md` and `.cline/rules/*.md` (rules with `paths:` are on demand), root `AGENTS.md`, `.cursorrules`, `.windsurfrules`, skill entries | skill description 1,024 chars (flagged) | [rules](https://docs.cline.bot/features/cline-rules), [skills](https://docs.cline.bot/customization/skills) |
| Windsurf | `.devin/rules` and `.windsurf/rules` (`trigger: always_on` loads, other triggers are on demand), root `AGENTS.md` or `agents.md`, `.windsurfrules`, skill entries | 12,000 chars per workspace rule (flagged) | [memories](https://docs.devin.ai/desktop/cascade/memories), [AGENTS.md](https://docs.devin.ai/desktop/cascade/agents-md), [skills](https://docs.devin.ai/desktop/cascade/skills) |
| Aider | Nothing: a conventions file only counts if you pass it with `--read` (shown as on demand) | repo map budget is not counted | [conventions](https://aider.chat/docs/usage/conventions.html), [repo map](https://aider.chat/docs/repomap.html) |
| Zed | The first of `.rules`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md`, `AGENT.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`; skill entries from `.agents/skills` | skill catalog 50 KB (overflow dropped) | [instructions](https://zed.dev/docs/preview/ai/instructions.html), [skills](https://zed.dev/docs/preview/ai/skills.html) (preview docs) |

## Things worth knowing

- **Your files only.** The tools' own system prompts and built-in tool definitions are not counted.
- **Home directory.** User-level files (`~/.claude/CLAUDE.md`, ...) are read only with
  `--include-user`, so output is reproducible by default.
- **Assumptions are labelled.** Examples: where OpenCode's upward search stops is undocumented
  (ctxsize stops at the repo root), and a Windsurf rule without a `trigger` is counted as always on.
  They appear as notes under the tool.
- **Linked folders count once.** If `.claude/skills` is a symlink to `.agents/skills`, the skills are
  not counted twice.
- **Models.** Each tool is measured with a model (context window and tokenizer; ctxsize has no prices, you give yours with `--price`). Reports mark a
  model ctxsize picked itself with `*`; see [CONFIG.md](CONFIG.md#models).

## MCP servers

`ctxsize` lists the MCP servers a repo configures in each tool's documented project file:

| Tool | File |
| --- | --- |
| Claude Code | `.mcp.json` ([docs](https://code.claude.com/docs/en/mcp)) |
| Cursor | `.cursor/mcp.json` ([docs](https://cursor.com/docs/context/mcp)) |
| GitHub Copilot (VS Code) | `.vscode/mcp.json` ([docs](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)) |
| Gemini CLI | `.gemini/settings.json` ([docs](https://geminicli.com/docs/tools/mcp-server/)) |
| Codex | `.codex/config.toml` ([docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)) |
| OpenCode | `opencode.json` ([docs](https://opencode.ai/docs/mcp-servers/)) |

By default that is all: reading config files runs nothing. With **`--mcp`**, ctxsize starts each
distinct *local* (stdio) server from those files once, asks it for `tools/list`, counts the tokens of
the tool definitions and stops it. **This runs the commands in the repo's config**, so only use it on
repos you trust. Details:

- Remote (URL) servers are never contacted.
- The commands to be run are printed first.
- A server gets only `PATH`, home/temp folders and the `env` its config sets, not your other
  environment variables.
- Each server has 10 seconds; failures are reported, not fatal.
- The number is an upper bound: some tools load MCP tool definitions on demand (Claude Code uses
  tool search by default).
