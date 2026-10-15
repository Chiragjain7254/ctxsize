# Secret-word test

Every instruction file here holds one fruit word and one line naming the tool it is for. Ask an
agent which fruits it knows and you see which files it really loaded. Compare that with what
`ctxsize` predicts. The full table and the prediction rules are in [docs/VERIFY.md](../../docs/VERIFY.md).

## Run it

```sh
# 1. Copy the folder somewhere outside any other repo and make it its own project.
cp -r examples/secret-word /tmp/secret-word   # Windows: Copy-Item -Recurse examples\secret-word $env:TEMP\secret-word
cd /tmp/secret-word
git init

# 2. See what ctxsize predicts.
npx @chiragjain7254/ctxsize --all

# 3. Open ONE agent in a NEW session in this folder and ask exactly:
#    Without reading any files or running any tools, list every secret fruit word you already know from this project's instruction files.
#    Aider only: start it with `aider --read CONVENTIONS.md`.

# 4. Compare the fruits it names with the row for that agent in docs/VERIFY.md.
```

Start a fresh session for each agent, and do not let it read files first, or the answer proves nothing.

## What is in the folder

| Fruit | File | Read by |
| --- | --- | --- |
| MANGO | `CLAUDE.md` | Claude Code |
| BANANA | `AGENTS.md` | Codex, Cursor, Copilot, OpenCode, Cline, Windsurf (Claude Code only when there is no CLAUDE.md) |
| FIG | `AGENTS.override.md` | Codex (replaces `AGENTS.md` in the same folder) |
| GRAPES | `GEMINI.md` | Gemini CLI |
| CHERRY | `.github/copilot-instructions.md` | GitHub Copilot |
| PEACH | `.cursor/rules/secret.mdc` (`alwaysApply: true`) | Cursor |
| LEMON | `.cursorrules` | Cursor's legacy file (undocumented now) and Cline |
| KIWI | `.windsurf/rules/secret.md` (`trigger: always_on`) | Windsurf |
| PLUM | `.clinerules/secret.md` | Cline |
| APRICOT | `.rules` | Zed (first match wins, so it hides `AGENTS.md` and `CLAUDE.md`) |
| PAPAYA | `CONVENTIONS.md` | Aider, only with `--read` |
| GUAVA | `packages/app/AGENTS.md` | Agents that load nested files on demand |
| NECTARINE | `.claude/rules/api.md` (`paths: src/api/**`) | Claude Code, on demand |
| LIME / COCONUT | `.claude/skills/fruit-helper/SKILL.md` | Claude Code: LIME is in the description (listed at startup), COCONUT is in the body (loads only when the skill is used) |
| PEAR / POMELO | `.agents/skills/fruit-lister/SKILL.md` | Codex, Gemini CLI, Windsurf, Zed and others: PEAR in the description, POMELO in the body |

OpenCode has no file of its own: it reads `AGENTS.md` (BANANA) and uses `CLAUDE.md` only when
there is no `AGENTS.md`.

`.ctxsizeignore` keeps this folder out of ctxsize's scan of its own repository. It is not an
instruction file for any agent.
