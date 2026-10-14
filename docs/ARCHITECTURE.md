# Architecture

ctxsize is a Node CLI written in TypeScript (ESM). It reads the files in a repo, works out which of
them each coding agent loads at startup, counts the tokens, and applies the limits that each agent's
public docs describe. It never runs an agent and never uses the network.

## How a run flows

```text
cli.ts -> run.ts
  parse flags, load ctxsize.json (config.ts), build the tool list (tools.ts)
  core/analyze.ts, once per tool:
    loader(ctx)         -> the files this tool loads (src/agents/*)
    countTokens(...)    -> tokens per file, with the tool's model tokenizer
    simulate(...)       -> what the tool drops or may drop (simulate.ts)
    summarize           -> startup / on-demand totals, usage, top files
  checks.ts             -> duplicates, suggestions, skill health
  mcp/                  -> MCP servers (only started with --mcp)
  report/*              -> terminal, JSON, HTML, markdown, card, badge
```

## Folder structure

```text
src/            the program (the files are listed below)
  agents/       one loader per hand-written tool, plus the data-driven loader
  core/         file walking, tokens, shared types
  mcp/          finding and measuring MCP servers
  report/       every output format
test/           Vitest tests, mirroring src/
  fixtures/     tiny fake repos, one per behaviour under test
docs/           user and contributor docs
.github/        CI workflow, issue and PR templates
```

Build output goes to `dist/` (built by `tsdown`, entry `src/cli.ts`). It is git-ignored and is the
only folder that is published to npm.

## What each file in `src/` does

### Top level

| File | Purpose |
| --- | --- |
| `cli.ts` | Entry point. Passes `process.argv`, stdout, stderr, env and cwd to `run()` and sets the exit code. |
| `run.ts` | Parses flags with `node:util` `parseArgs`, validates combinations, runs the analysis and writes the outputs. Holds the `--help` text and the exit codes (0 ok, 1 over budget, 2 usage). |
| `config.ts` | Reads and strictly validates `ctxsize.json` (or the `"ctxsize"` key in `package.json`). A typo is an error. |
| `profiles.ts` | Every documented limit, each with its source URL and checked date. Also the data-driven tools (`specProfiles`). |
| `models.ts` | Model presets (context window, tokenizer, price, sources), the default model per tool, and how `--model` and the config pick one. |
| `tools.ts` | Builds the list of tools: hand-written loaders, data-driven specs, and tools from the config. |
| `simulate.ts` | Applies each tool's limits to the loaded files and reports what is dropped or may be dropped. |
| `checks.ts` | Smart checks over the report: duplicate instructions, ways to cut tokens, skill health. Pure functions, no file access. |
| `history.ts` | Reads files from git objects for `--diff` and `--history`. Never checks anything out. |
| `tree.ts` | `--tree`: startup tokens per nested starting folder. |
| `watch.ts` | `--watch`: runs again after file changes. Changes are debounced and runs never overlap. |
| `check-profiles.ts` | `--check-profiles`: prints `profiles.ts` limits, sources and dates. |
| `version.ts` | The `VERSION` constant shown by `--version` and written into reports. |

### `agents/`

| File | Purpose |
| --- | --- |
| `index.ts` | The `loaders` map, from agent id to loader. |
| `claude.ts` | Claude Code: `CLAUDE.md` files up the tree, `@path` imports, rules, skills and auto memory. |
| `codex.ts` | Codex: one `AGENTS.md` per folder, plus a listing of skills. |
| `cursor.ts` | Cursor: `.cursor/rules` (`.mdc`, with frontmatter modes), `AGENTS.md` and `.cursorrules`. |
| `copilot.ts` | GitHub Copilot's cloud agent: repository instructions and path-specific instructions. |
| `gemini.ts` | Gemini CLI: `GEMINI.md` files, `@` imports and skills. |
| `spec.ts` | The loader for tools described as data (`ToolSpec`): OpenCode, Cline, Windsurf, Aider, Zed and anything defined in `ctxsize.json`. |

### `core/`

| File | Purpose |
| --- | --- |
| `types.ts` | The shared types: `LoadedItem`, `Loader`, `ToolSpec`, `Report` and more. Loaders, the simulator and the reports all depend on them. |
| `analyze.ts` | Runs a loader, counts tokens, runs the simulator and builds the `Report`. |
| `tokenize.ts` | Token counting (see below). |
| `fs.ts` | Reading and walking files. Respects `.gitignore`, skips `node_modules`, `dist`, `build` and `.git`, and prints POSIX-style relative paths on every OS. |
| `gitignore.ts` | A small `.gitignore` reader. |
| `glob.ts` | A small glob matcher (`**`, `*`, `?`, `{a,b}`). |
| `frontmatter.ts` | Parses YAML frontmatter from rule and skill files. |
| `imports.ts` | Follows `@path` imports. |
| `items.ts` | Helpers that build `LoadedItem`s, read skill folders and create warnings. |
| `usage.ts` | Percent of the window, overhead over N messages, cost, and the top files. |

### `mcp/`

| File | Purpose |
| --- | --- |
| `config.ts` | Finds the MCP servers each tool's config files define. Only reads files. |
| `measure.ts` | Starts a local server, asks it for its tools over stdio, and stops it. Only used with `--mcp`. |
| `index.ts` | Adds the MCP results to the report. The same command is started once for all tools. |

### `report/`

| File | Purpose |
| --- | --- |
| `terminal.ts` | The table printed in the terminal. |
| `json.ts` | The `--json` output. |
| `html.ts` | The interactive HTML page (and the `.data.js` file for `--watch`). |
| `page-client.ts` | The browser-side code of the page. It is copied into the HTML as text, so it must not import anything. |
| `calc.ts` | The numbers behind the page. It is also copied into the page, so it has no imports and the tests run the same code. |
| `treemap.ts` | The squarified treemap layout. |
| `diff.ts` | Terminal output for `--diff` and `--history`. |
| `history-html.ts` | The `--history --html` chart. |
| `share.ts` | The markdown summary, SVG card and SVG badge. |
| `common.ts` | Small shared text, such as the "tokens are estimates" note. |

## Token counting

`core/tokenize.ts` counts the tokens of the exact text an agent injects (for a skill, its listing entry,
not the whole body).

- Two public BPE tokenizers are built in: `o200k_base` and `cl100k_base` (from `js-tiktoken`).
- For models whose tokenizer is not public (Llama, Qwen, DeepSeek and so on), a model can set
  `{ "charsPerToken": 3.8 }`; the count is the characters divided by that ratio, rounded up.
- A long run of one repeated character is counted in fixed slices, because BPE is very slow on such text.
- Each tool is counted with its own model's tokenizer. The count is exact only when the model's own
  tokenizer is used (OpenAI models, and even then the docs do not name it). Claude and Gemini counts use
  `o200k_base`. **Every count is an estimate** and is labelled that way in all outputs.
- Cost is startup tokens times the number of messages (default 50), at the model's uncached input price.

## Agent profiles and limits

`src/profiles.ts` is the single place for documented limits, such as Codex's 32 KiB cap on combined
`AGENTS.md` bytes. Each profile has `sources` (URL, checked date, optional note). Rules:

- A claim about how an agent behaves needs an official docs link there.
- No other file may hard-code a limit. Loaders and `simulate.ts` read them from the profile.
- If the docs say nothing, record that in `notes` and set no limit. Do not guess.
- When a limit changes, update the value, the URL and the date together, and add a CHANGELOG line.

There are two kinds of tool:

1. **Hand-written** (`claude`, `codex`, `cursor`, `copilot`, `gemini`): a loader in `src/agents/` because their
   rules are too specific for data. Their limits are the keys of `profiles`.
2. **Data-driven** (the rest, and your own in `ctxsize.json`): a `ToolSpec` in `specProfiles` that lists the
   instruction files, rule folders, skill folders and limits. `agents/spec.ts` reads it.
   See [CONFIG.md](CONFIG.md) for every field.

A loader returns the items a tool loads (path, category, whether it loads at `startup`, `on-demand` or is
`ignored`, the reason, and the text). It does not apply limits. `simulate.ts` does that afterwards, so loaders
stay simple.

## How to add a new agent

First choose the kind. If a `ToolSpec` can describe the agent, use the data-driven way. It is smaller and
needs no new loader.

### Data-driven (preferred)

1. Find the agent's official docs for its instruction files, rules, skills and size limits.
2. Add an entry to `specProfiles` in `src/profiles.ts` with `label`, `instructions` / `rules` / `skills`, any
   `limits`, and `sources` with the docs URL and today's date. Put anything the docs do not say in `notes`.
3. Add a test with a small fake repo (use `tmpRepo` from `test/helpers.ts`, or a folder in
   `test/fixtures/`). Check which files load and when.
4. Add the agent to the lists in the README, `docs/tools.md` and `docs/CLI.md` (`--agents`), and add a CHANGELOG line.
5. Run `npm run check`.

### Hand-written loader

1. Add the agent id to `AgentId` and `AGENT_IDS` in `src/core/types.ts`.
2. Add a profile with limits and `sources` to `profiles` in `src/profiles.ts`. A test checks that every
   agent has a profile with an https source and a checked date.
3. Create `src/agents/<agent>.ts` that exports `load(ctx: LoaderContext)` and returns `{ items, warnings }`.
   Use `makeItem` and `readSkillsDir` from `core/items.ts`, `walkFiles` and `toPosixRel` from `core/fs.ts`,
   and `node:path` for every path. Leave limits to `simulate.ts` and add the agent's rules there.
4. Register it in `src/agents/index.ts`.
5. Add `test/agents/<agent>.test.ts`, following the existing ones.
6. Update the README, `docs/tools.md`, `docs/CLI.md` and the CHANGELOG, then run `npm run check`.

## Rules that apply everywhere

- Cross-platform: use `node:path` and print POSIX-style relative paths. Never assume `/` or `\`.
- Token counts are estimates and must be labelled so.
- Keep `npm run check` green before every commit.
