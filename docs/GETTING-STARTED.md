# Getting started in 5 minutes

You need Node 22.12 or newer and a repo that has some agent files, like `AGENTS.md` or `CLAUDE.md`.

## 1. Run it (1 minute)

```sh
npx @chiragjain7254/ctxsize
```

You get a table. Each row is one coding agent.

- **Startup** is the number of tokens the agent loads before your first prompt. A token is a small piece of text, about four letters.
- **% ctx** is that number as a share of the model's context window (the amount of text the model can read at once).
- **On demand** is what loads later, only when the agent needs it.

All numbers are estimates.

## 2. See the cost (30 seconds)

Look at the "Cost of carrying it" table. The startup text is sent with every message. So the cost is startup tokens times the number of messages. The default is 50. Change it:

```sh
npx @chiragjain7254/ctxsize --messages 200
```

Prices are for uncached input. Prompt caching makes real costs lower.

## 3. See what gets cut (1 minute)

Look for the "Dropped or at risk" part.

- `✗` means the agent will cut it. Example: Codex stops reading `AGENTS.md` after 32 KiB.
- `?` means it may be cut. Example: Claude Code drops skill descriptions when the skill list is too big.

Each line links to the tool's own docs in [`src/profiles.ts`](../src/profiles.ts).

## 4. Open the interactive report (1 minute)

```sh
npx @chiragjain7254/ctxsize --html
```

Open `ctxsize-report.html`. You can:

- pick a model for each tool and change the window, price and message count,
- untick a file to see what you would save,
- drag tools to reorder them, click headers to sort, and search files,
- switch between light and dark.

Want it to update while you edit? Add `--watch`.

## 5. Add it to CI (1 minute)

```sh
npx @chiragjain7254/ctxsize --max-tokens 10000
```

It exits with `1` if any agent loads more than 10,000 tokens at startup. Put that line in your CI job.

For a pull request comment, use `--markdown summary.md`. To compare with the main branch, use `--diff main`.

## Next

- Measure only some tools: `--agents claude,codex`.
- Add your own tool or change a model: [CONFIG.md](CONFIG.md).
- What each tool reads: [tools.md](tools.md).
