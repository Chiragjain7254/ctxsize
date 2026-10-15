# CLI reference

```text
ctxsize [dir] [options]
```

`dir` is the folder the agents start in. It defaults to the current folder. The repo root is the
nearest parent folder with a `.git`. Pass at most one directory.

The examples use `npx @chiragjain7254/ctxsize`. If you installed it globally, type `ctxsize` instead.
Run `ctxsize --help` to print the same list in your terminal. All token counts are estimates.

## Exit codes

| Code | Meaning | Examples |
| --- | --- | --- |
| `0` | OK. The report was printed and no gate failed. | A normal run, `--help`, `--version`, `--check-profiles`. Warning checks (`!`) alone do not fail a run. |
| `1` | A gate failed. The report is still printed; each failure is a line on stderr. | An agent is over `--max-tokens` or `--max-percent`, a tool is over its `maxTokens` budget in `ctxsize.json`, or `--fail-on-warnings` found a `!` check. |
| `2` | Usage error. Nothing is analyzed, stdout is empty and stderr says what to fix. | An unknown flag, a missing or bad value, an unknown agent or model, two flags that cannot be combined, a directory that does not exist, a bad `ctxsize.json`, `--diff`/`--history` outside a git repository or with a bad ref. |

An unexpected crash is a bug, not one of these codes: Node prints the error and exits `1`. If you see a stack
trace, please [open an issue](https://github.com/Chiragjain7254/ctxsize/issues/new?template=bug_report.yml).

In CI, `--quiet` keeps the log to the summary line plus these stderr messages. `test/exit-codes.test.ts` has a test for
every code and every reason above.

## Choose what to measure

### `--agents <list>`

Comma-separated tool ids. Default: every tool. Built-in ids: `claude`, `codex`, `cursor`, `copilot`,
`gemini`, `opencode`, `cline`, `windsurf`, `aider`, `zed`, plus any tool defined in `ctxsize.json`.
An unknown id is a usage error (exit `2`).

```sh
npx @chiragjain7254/ctxsize --agents claude,codex
```

### `--all`

By default, tools that load nothing from this repo (0 startup tokens and 0 on-demand tokens) are left out
of the table, and one line after it names them: `Hidden: Aider, Zed (no files found) — use --all to show`.
`--all` shows every tool. `--agents` always shows the tools you list, even when they load nothing. The
same rule applies to `--json` (which gains a `hidden` array of tool ids), `--markdown` and `--html`. In a
repo with no agent files at all, everything is hidden and the output says so.

```sh
npx @chiragjain7254/ctxsize --all
```

### `--include-user`

Also read files from your home directory, such as `~/.claude/CLAUDE.md`. Default: off, so the output is
the same on every machine.

```sh
npx @chiragjain7254/ctxsize --include-user
```

### `--exclude <glob>`

Leave files out of the scan, as if they did not exist. Repeatable. Globs are relative to the repo root and
use `/`; `*`, `**`, `?` and `{a,b}` work. A name without a `/` matches at any depth
(`CLAUDE.local.md`), and a folder excludes everything inside it (`docs/old`). Because the file is treated as
absent, rules that depend on it follow: excluding the only `CLAUDE.md` lets Claude Code read `AGENTS.md`.
Patterns from `"exclude"` in `ctxsize.json` are added to the ones on the command line.

```sh
npx @chiragjain7254/ctxsize --exclude "packages/legacy/**" --exclude CLAUDE.local.md
```

### `--no-checks`

Skip the duplicate-instruction, suggestion and skill-health checks. Default: the checks run.

```sh
npx @chiragjain7254/ctxsize --no-checks
```

## Choose the model and cost

### `--model <choice>`

The model each tool is measured with. Give one id for every tool, or `tool=id` pairs separated by commas.
Default: ctxsize picks a model per tool and marks it with `*` in the output. `--model` wins over the
`model` set in `ctxsize.json`. An unknown tool or model is a usage error. Model ids come from the
presets listed in `ctxsize --help` and from `ctxsize.json`.

```sh
npx @chiragjain7254/ctxsize --model claude=claude-haiku-5-5,codex=gpt-5.3-codex
```

### `--context <tokens>`

The context window to model, in tokens. Default: the chosen model's own window. A positive whole
number; `_` is allowed, as in `1_000_000`.

```sh
npx @chiragjain7254/ctxsize --context 200000
```

### `--price <usd>`

USD per 1 million input tokens, replacing every model's price. Default: each model's own price. A
number, 0 or more.

```sh
npx @chiragjain7254/ctxsize --price 3
```

### `--messages <n>`

How many messages to assume when computing the cost of carrying the startup load. Default: `50`, or
`messages` from `ctxsize.json`. A positive whole number.

```sh
npx @chiragjain7254/ctxsize --messages 200
```

## Output

### `--json`

Print the report as JSON instead of the table. Colors are off. The `schemaVersion` field is `2`. `tool.version` is the ctxsize version and `generatedAt` is the UTC time the report was made; set `SOURCE_DATE_EPOCH` (seconds) to pin it for reproducible output. The format is described by [report.schema.json](report.schema.json) (JSON Schema 2020-12); a test checks real output against it. `--history --json` has its own shape. `agents` lists the tools that are shown; `hidden` lists the ids of tools left out because they load nothing (see `--all`).

```sh
npx @chiragjain7254/ctxsize --json > report.json
```

### `--html`

Write an interactive treemap report. Default file: `ctxsize-report.html` in the current folder (change it
with `--out`). With `--history`, it writes the trend chart instead.

```sh
npx @chiragjain7254/ctxsize --html
```

### `--out <file>`

Where `--html` writes. It only works together with `--html`; alone it is a usage error.

```sh
npx @chiragjain7254/ctxsize --html --out reports/ctx.html
```

### `--open`

After `--html` writes the report, open it in your default browser (`start` on Windows, `open` on macOS,
`xdg-open` on Linux). It works with `--html`; with `--serve` the browser opens by default. Without it, ctxsize prints the hint
`Open it with: ctxsize --html --open, or view it live with: ctxsize --serve`. If the browser cannot be launched, you get a warning and the
report is still written. With `--watch`, the page opens once.

```sh
npx @chiragjain7254/ctxsize --html --open
```

### `--serve`

Start a local web server with the same interactive report that `--html` writes (`--html` itself is
unchanged and still writes `ctxsize-report.html`). It uses only Node's built-in `node:http`, listens on
`127.0.0.1` and prints `ctxsize report running at http://localhost:<port> — press Ctrl+C to stop`. Your
default browser opens automatically; add `--no-open` to skip that.

- `GET /` is the report page, `GET /api/report` is the same JSON as `--json`, and `GET /events` is the
  Server-Sent Events stream the page listens to.
- It watches the same files as `--watch`. After a change the analysis runs again and the open page
  updates without a reload. The checks, folder and MCP lists and the share buttons at the bottom of the
  page are fixed to the run that served the page, as with `--watch --html`; reload to refresh them.
- The top right of the page shows a status dot with the time the report last changed: green and
  `live · updated 9:09:27 PM` while it is connected, red and `disconnected · last updated 9:09:27 PM,
  reconnecting` when the server stops or the connection drops. The browser reconnects by itself and the
  dot turns green again.
- The usual flags work with it: `--agents`, `--all`, `--model`, `--context`, `--price`, `--messages`,
  `--include-user`, `--tree`, `--no-checks`.
- It cannot be combined with `--html`, `--json`, `--markdown`, `--card`, `--badge`, `--diff`,
  `--history`, `--mcp`, `--quiet` or a gate (`--max-tokens`, `--max-percent`, `--fail-on-warnings`); that is a
  usage error.

```sh
npx @chiragjain7254/ctxsize --serve
npx @chiragjain7254/ctxsize --serve --agents claude,codex --model claude=claude-haiku-5-5
```

### `--port <n>`

The first port for `--serve` (0 to 65535). Default: `4321`. If it is taken, the next 9 ports are tried,
and the message shows the one that was used. `0` asks the system for a free port. It needs `--serve`.

```sh
npx @chiragjain7254/ctxsize --serve --port 8080
```

### `--no-open`

With `--serve`, do not open the browser. It needs `--serve`, and cannot be combined with `--open`.

```sh
npx @chiragjain7254/ctxsize --serve --no-open
```

### `--markdown <file>`

Write a summary table for a pull-request comment. Use `-` to print it to the terminal instead of the
normal table. Default: off.

```sh
npx @chiragjain7254/ctxsize --markdown summary.md
```

### `--card <file.svg>`

Write an SVG summary card. Default: off.

```sh
npx @chiragjain7254/ctxsize --card card.svg --title "My repo"
```

### `--title <text>`

The heading of the `--card` image. Default: `ctxsize report`.

```sh
npx @chiragjain7254/ctxsize --card card.svg --title "Agent load"
```

### `--badge <file.svg>`

Write an SVG README badge and print a shields.io snippet you can paste into the README. Default: off.

```sh
npx @chiragjain7254/ctxsize --badge badge.svg
```

### `--quiet`

Print one summary line instead of the table: `ctxsize: startup tokens (estimates): Claude Code ~1,634, Codex ~296`.
Progress messages such as `Wrote ctxsize-report.html` are not printed; gate failures (`--max-tokens`) and
errors still go to stderr. `--json` is unchanged. It cannot be combined with `--watch` or `--serve`.

```sh
npx @chiragjain7254/ctxsize --quiet --max-tokens 8600
```

### `--sort <key>`

Order the agent table and the cost table in the terminal report: `startup` (biggest load first),
`cost` (most expensive first) or `name` (A to Z). Default: the order of the tools. `--json`, the HTML
report and the other outputs keep the tool order.

```sh
npx @chiragjain7254/ctxsize --sort startup
```

### `--top <n>`

How many files to list under "Biggest files at startup" (default 5). A positive whole number. It also
sets how many entries each agent's `topFiles` has in `--json`.

```sh
npx @chiragjain7254/ctxsize --top 10
```

### `--no-color`

Turn colors off. `NO_COLOR` is honoured too. Colors are on when the output is a terminal (or
`FORCE_COLOR` is set), and always off with `--json`.

```sh
npx @chiragjain7254/ctxsize --no-color
```

## Go further

### `--tree`

Also show the startup tokens when the agent starts in each nested folder, which is useful in monorepos.
It lists up to 30 folders; a note says how many more were skipped. Default: off.

```sh
npx @chiragjain7254/ctxsize --tree
```

### `--mcp`

Start the local MCP servers found in the repo's config and count the tokens of their tool definitions.
**This runs the configured commands**, so use it only on repos you trust. Remote servers are never
contacted. Without the flag, ctxsize only lists the servers it finds. It cannot be combined with
`--watch`.

```sh
npx @chiragjain7254/ctxsize --mcp
```

### `--watch`

Run again whenever files in the repo change (changes are grouped over 300 ms). Press Ctrl+C to stop. With
`--html`, the open page updates itself from a `.data.js` file written next to it. It cannot be combined
with `--mcp` or `--max-tokens`.

```sh
npx @chiragjain7254/ctxsize --watch --html
```

### `--diff <git ref>`

Also compare with the same repo at a branch, tag or commit. Needs a git repo; a bad ref is a usage
error. It cannot be combined with `--history`.

```sh
npx @chiragjain7254/ctxsize --diff main
```

### `--history <n>`

Show startup tokens over the last `n` commits (1 to 200). The working tree is not analyzed. Add `--html`
for a chart or `--json` for data. It cannot be combined with `--diff` or `--max-tokens`.

```sh
npx @chiragjain7254/ctxsize --history 20 --html
```

### `--max-tokens <n>`

Exit `1` if any agent loads more than `n` tokens at startup, and name each one on stderr. A whole number,
0 or more; `_` is allowed. Default: no limit. Use it as a CI gate.

```sh
npx @chiragjain7254/ctxsize --agents claude --max-tokens 8600
```

### `--max-percent <n>`

Exit `1` if any agent uses more than `n` percent of its context window at startup, and name each one on
stderr. A number from 0 to 100. The window is the model's own, or what `--context` sets. Use it with or
instead of `--max-tokens` (and the per-tool `tools.<id>.maxTokens` budgets from `ctxsize.json`); both can fail in one run. Like `--max-tokens`, it cannot be combined with
`--watch`, `--serve` or `--history`.

```sh
npx @chiragjain7254/ctxsize --max-percent 2
```

### `--fail-on-warnings`

Exit `1` if any check marked `!` fires: duplicated instructions, or a skill with no description. Each one is
printed on stderr. Checks marked `i` (suggestions) never fail it. It needs the checks, so it cannot be
combined with `--no-checks`, and like the other gates it cannot be combined with `--watch`, `--serve` or
`--history`.

```sh
npx @chiragjain7254/ctxsize --fail-on-warnings
```

### `--check-profiles`

Print every documented agent limit with its source URL and the date it was last checked. It reads no
repo files and uses no network.

```sh
npx @chiragjain7254/ctxsize --check-profiles
```

## Other

### `-v`, `--version`

Print the version.

```sh
npx @chiragjain7254/ctxsize --version
```

### `-h`, `--help`

Print the help text.

```sh
npx @chiragjain7254/ctxsize --help
```
