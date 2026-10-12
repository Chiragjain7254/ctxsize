# ctxsize

See what every coding agent loads before your first prompt, in tokens, and what each one silently drops.

Claude Code, Codex, Cursor, GitHub Copilot and Gemini CLI each read a different set of
instruction files, rules and skills at startup, and each one has limits that cut things off
without telling you. `ctxsize` models that statically: it reads your repo, never runs an agent
and never touches the network.

> v0.1 is not released yet. Run it from a clone for now (see [Development](#development)).

## Usage

```sh
npx ctxsize            # the current directory
npx ctxsize path/to/repo
npx ctxsize --json     # stable, diffable report
npx ctxsize --html     # treemap in ctxsize-report.html
```

Options:

| Option | Meaning |
| --- | --- |
| `--agents <list>` | Comma-separated: `claude,codex,cursor,copilot,gemini` (default: all) |
| `--context <tokens>` | Context window to model (default: 200000) |
| `--include-user` | Also read files from your home directory (not reproducible) |
| `--json` | Print the report as JSON |
| `--html` | Write a treemap to `ctxsize-report.html` (or the file given with `--out`) |
| `--out <file>` | Where to write `--html` |
| `--max-tokens <n>` | Exit 1 if any agent loads more than `n` tokens at startup |
| `--no-color` | Disable colors (`NO_COLOR` is honoured too) |

Exit codes: `0` ok, `1` over `--max-tokens`, `2` usage error.

## Example

`vercel/next.js` at commit `500ed3f24097a522decee5bf669ceb0c01320efc`:

```text
ctxsize v0.0.0  what each agent loads before your first prompt

  Agent           Instructions  Rules  Skills  Startup   On demand
  Claude Code            6,819      0   2,000    8,819  1,420 (10)
  Codex                  6,819      0   1,712    8,531           0
  Cursor                 6,819      0       0    6,819   1,410 (8)
  GitHub Copilot         6,819      0       0    6,819   1,410 (8)
  Gemini CLI                 0      0   2,099    2,099           0

Dropped or at risk
  Codex
    ✗ description cut: skill backport-pr  (−72 B, 16 tokens)
    ✗ description cut: skill dce-edge  (−40 B, 8 tokens)
    ✗ description cut: skill deploy-release-test  (−211 B, 40 tokens)
    … 11 more (see --json)

Notes
  Codex: Skill listing is 9,653 chars, over its 8,000 chars budget: descriptions are shortened.
```

The run takes about 2.5 s on that 34,000-file repo (Windows, cold cache). Its `.claude/skills`
is a symlink to `.agents/skills`; the numbers above were taken with that link in place.

## What is counted, and what is not

- **Counted:** your files only: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, rules, `@imports`, and the
  skill listing each agent builds from skill names and descriptions.
- **Not counted:** the agents' own system prompts and built-in tools, MCP tool schemas, and
  anything an agent reads later on demand (those files are shown in the "On demand" column).
- **Estimates:** token counts use the `o200k_base` tokenizer for every agent, so they are
  comparable with each other but not exact. Anthropic's tokenizer is not public.
- **Reproducible by default:** without `--include-user` your home directory is never read, and
  searches for ancestor files stop at the repo root.

## Where the rules come from

Every limit lives in [`src/profiles.ts`](src/profiles.ts) with its source and the date it was
checked. Behaviour claims link to the official docs:

- Claude Code: [memory](https://code.claude.com/docs/en/memory.md), [skills](https://code.claude.com/docs/en/skills.md)
- Codex: [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [skills](https://learn.chatgpt.com/docs/build-skills)
- Cursor: [rules](https://cursor.com/docs/context/rules)
- GitHub Copilot (cloud agent): [repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions), [support matrix](https://docs.github.com/en/copilot/reference/custom-instructions-support)
- Gemini CLI: [GEMINI.md](https://geminicli.com/docs/cli/gemini-md/), [skills](https://geminicli.com/docs/cli/skills/)

Where the docs are silent, ctxsize says so in the output rather than guessing.

## Gate your CI on it

```sh
npx ctxsize --max-tokens 10000 --agents claude,codex
```

Exits `1` and names the agent when its startup load is over the limit, for example:

```text
ctxsize: Claude Code loads 8,819 tokens at startup, over --max-tokens 8,600
```

## FAQ

**Why not exact token counts?** That needs each provider's tokenizer or API. ctxsize makes no
network calls, so it gives one consistent estimate instead.

**Does it work on Windows?** Yes. Paths in the report are always POSIX-style relative paths, and
CI runs on Windows, macOS and Linux.

**Does it read my home directory?** Only with `--include-user`.

## Development

```sh
npm ci
npm run check   # lint, typecheck, test, build
npm run dev -- path/to/repo
```

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.
