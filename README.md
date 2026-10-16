<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Chiragjain7254/ctxsize/main/docs/img/logo-wordmark-dark.svg">
  <img src="https://raw.githubusercontent.com/Chiragjain7254/ctxsize/main/docs/img/logo-wordmark.svg" alt="ctxsize" height="64">
</picture>

<p><b>See what your AI coding agent reads before you type, what it costs, and what it silently drops.</b></p>

<p>
<a href="https://www.npmjs.com/package/@chiragjain7254/ctxsize"><img alt="npm version" src="https://img.shields.io/npm/v/@chiragjain7254/ctxsize"></a>
<a href="https://www.npmjs.com/package/@chiragjain7254/ctxsize"><img alt="npm downloads per month" src="https://img.shields.io/npm/dm/@chiragjain7254/ctxsize"></a>
<a href="https://github.com/Chiragjain7254/ctxsize/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Chiragjain7254/ctxsize/actions/workflows/ci.yml/badge.svg"></a>
<a href="https://github.com/Chiragjain7254/ctxsize/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/Chiragjain7254/ctxsize"></a>
<a href="https://www.npmjs.com/package/@chiragjain7254/ctxsize"><img alt="Node version" src="https://img.shields.io/node/v/@chiragjain7254/ctxsize"></a>
</p>

</div>

```sh
npx @chiragjain7254/ctxsize --serve
```

![A 25-second demo: run one command, the Overview opens in the browser, hover a tooltip, type an example price in the Cost calculator, edit AGENTS.md, and the page updates by itself.](https://raw.githubusercontent.com/Chiragjain7254/ctxsize/main/docs/img/demo.gif)

## Sound familiar?

- You have both an `AGENTS.md` and a `CLAUDE.md`, and Claude Code reads only the `CLAUDE.md`. The `AGENTS.md` you wrote is skipped. ([source](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/WHY.md#which-file-does-my-agent-read), [Claude Code docs](https://code.claude.com/docs/en/memory.md))
- Your `CLAUDE.md` is loaded at the start of every session and stays in the conversation, so a long one costs tokens on every message. Caching makes that cheaper, never free. ([Claude Code docs](https://code.claude.com/docs/en/memory.md), [source](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/WHY.md#my-instruction-files-waste-tokens))
- Your `AGENTS.md` files add up to more than 32 KiB, and Codex stops reading at that limit. ([Codex docs](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [source](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/WHY.md#agents-silently-drop-or-ignore-files))
- The same paragraphs sit in two files that one agent reads, so you pay for them twice.

**ctxsize shows all of this in one command, and gives your setup a grade from A to F.**

## Why I built this

I kept wondering why my agent ignored instructions I'd written. Then I found [Claude Code issue #6235](https://github.com/anthropics/claude-code/issues/6235) asking for `AGENTS.md` support: 5,189 thumbs-up and 409 comments from developers with the same confusion (checked on 2026-10-16; it was closed in August 2026, and Claude Code now reads `AGENTS.md` when there is no `CLAUDE.md`). Others wrote about instruction files that are processed again on every turn ([an example](https://vantaige.io/blog/claude-code-token-waste-9-patterns-fixes-2026)), and about files that [silently do not load](https://github.com/google-gemini/gemini-cli/issues/28227). There was no easy way to see what my agent actually loads, so I built a tool that shows it. All sources: [docs/WHY.md](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/WHY.md).

— Chirag

## Your context health, as a grade

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Chiragjain7254/ctxsize/main/docs/img/report-mobile-dark.png">
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/Chiragjain7254/ctxsize/main/docs/img/report-mobile.png">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Chiragjain7254/ctxsize/main/docs/img/report-dark.png">
  <img src="https://raw.githubusercontent.com/Chiragjain7254/ctxsize/main/docs/img/report-light.png" alt="The ctxsize Overview: a verdict line with the grade C, a bar chart of what each agent reads, and the first things to fix." width="100%">
</picture>

Every agent and your repo overall get a grade. **A** means nothing to fix; anything cut off caps it at **C**. The grade is counted from the same list as the Fix list, so the two never disagree. Rules: [docs/GRADE.md](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/GRADE.md). Share it with `--card` (a picture) or `--badge` (a README badge):

![A share card: the grade C in a big colored square, the top fixes and a bar of startup tokens per agent.](https://raw.githubusercontent.com/Chiragjain7254/ctxsize/main/docs/img/card.png)

## Why this matters

In [a study of 50 popular repos](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/STUDY.md) (picked for being well known, not sampled):

- **36%** ship both a `CLAUDE.md` and an `AGENTS.md` at the root.
- **22%** have a file that some agent ignores.
- The median Claude Code startup load is **602 tokens**, the largest **7,514**.

Measured with ctxsize 0.1.0 on 2026-10-15. Tokens are estimates. Method and every repo: [docs/STUDY.md](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/STUDY.md).

## ctxsize vs doing it by hand

| | By hand | ctxsize |
| --- | --- | --- |
| Which files does each agent read? | Read each tool's docs, and re-read when they change | One command, limits from each tool's docs with a link and a date |
| Is a file cut off or ignored? | Count bytes against a limit you have to find | Named, with the tokens lost |
| What does it cost per message? | Guess | Tokens, and cost with your own price |
| Duplicates and weak skill descriptions? | Diff files by eye | Listed with a fix |
| Does it get worse over time? | You find out later | A CI check on every pull request |

## Try it on your repo in 10 seconds

```sh
cd your-repo
npx @chiragjain7254/ctxsize          # the terminal summary and your grade
npx @chiragjain7254/ctxsize --serve  # the live report in your browser
npx @chiragjain7254/ctxsize init     # a starter ctxsize.json, and a CI workflow if you want one
```

## Features

- **A grade and a Fix list**: what is cut off, at risk, duplicated or vague, each with how to fix it and what it saves.
- **10 agents**: Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Cline, Windsurf, Aider and Zed, plus any tool you describe in [`ctxsize.json`](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/CONFIG.md). Which files each one reads: [docs/tools.md](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/tools.md).
- **Your own price**: ctxsize has no prices of its own. Give yours with `--price` and it does the sums per message, day and month.
- **Live report**: `--serve` updates as you edit your files.
- **Share it**: `--card card.png`, `--badge`, `--markdown` for a pull request comment.
- **History and diffs**: `--history 20`, `--diff main`.
- Everything else: [docs/FEATURES.md](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/FEATURES.md), [every flag](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/CLI.md).

## Don't trust us, check it in 5 minutes

[`examples/secret-word`](https://github.com/Chiragjain7254/ctxsize/tree/main/examples/secret-word) hides one fruit in each instruction file. Open an agent there, ask which fruits it knows, and compare with what ctxsize predicted. Steps and the full table: [docs/VERIFY.md](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/VERIFY.md).

## Use it in CI

```yaml
- uses: Chiragjain7254/ctxsize@v0.2.0
  with:
    max-tokens: 8000
```

The job fails when an agent's startup load grows past your budget. `ctxsize init --workflow` writes the file for you. A pull request comment, the action's options and the exit codes are in [docs/CI.md](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/CI.md); pre-commit hooks, a VS Code task and more are in [docs/INTEGRATIONS.md](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/INTEGRATIONS.md).

## Privacy

**No network. No telemetry. Your files never leave your machine.** ctxsize reads files, applies limits from each tool's public docs and prints numbers. It never runs your agents. (`--mcp` starts the local MCP servers in your repo's config, only when you ask.)

<details>
<summary><b>FAQ</b></summary>

**Are the numbers exact?** No. They are estimates. Each provider counts tokens its own way, and ctxsize does not call any API.

**Where do the limits come from?** [`src/profiles.ts`](https://github.com/Chiragjain7254/ctxsize/blob/main/src/profiles.ts). Each limit has a docs link and the date it was last checked. If a doc says nothing, ctxsize says "not documented" instead of guessing.

**Does it read my home folder?** Only with `--include-user`.

**Does it work on Windows?** Yes. CI runs on Linux, macOS and Windows. Needs Node 22.12 or newer.

**Something went wrong?** See [docs/TROUBLESHOOTING.md](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/TROUBLESHOOTING.md).

</details>

## Help make it better

This started as one person's frustration. Your agent, your repo and your ideas make it better.

- ⭐ **Star it** if it helped.
- 🅰️ **Show us your grade** in the [Discussions](https://github.com/Chiragjain7254/ctxsize/discussions).
- 🛠️ **Fix a [good first issue](https://github.com/Chiragjain7254/ctxsize/labels/good%20first%20issue).** Your first PR can take 10 minutes: [CONTRIBUTING.md](https://github.com/Chiragjain7254/ctxsize/blob/main/CONTRIBUTING.md). Adding an agent takes about 15: [docs/ADD-AGENT.md](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/ADD-AGENT.md).
- 🧪 **Found an agent that behaves differently from what ctxsize predicts?** Run the [fruit test](https://github.com/Chiragjain7254/ctxsize/blob/main/docs/VERIFY.md) and [open an issue](https://github.com/Chiragjain7254/ctxsize/issues/new?template=agent-behavior-changed.yml). That is the most valuable contribution.

Where it is going: [ROADMAP.md](https://github.com/Chiragjain7254/ctxsize/blob/main/ROADMAP.md). Ideas that change the direction of the project are welcome too. MIT licensed.
