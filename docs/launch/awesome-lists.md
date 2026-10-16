# Awesome lists: drafts

**Drafts only. Nothing here has been submitted.** I read each list's contributing rules on 2026-10-16 (through the
GitHub API, not from memory). Rules change; re-read before you submit. Star counts are from the same day.

ctxsize was created on 2026-10-12 and has 0 stars, so several lists will not take it yet. Dates below assume the
first commit on the default branch was 2026-10-12 (it was).

Honest summary: **two lists are a real fit, one of them only after 2026-10-26; the rest are not a fit, and trying
them would just waste a maintainer's time.** Other tools in the same space exist (for example ctxlint, Caliber and
agnix); ctxsize's difference is weighing tokens against each agent's documented limits, across ten agents, offline.

## Recommended

### 1. hesreallyhim/awesome-claude-code (about 55,800 stars)

- Link: <https://github.com/hesreallyhim/awesome-claude-code>, rules in [CONTRIBUTING.md](https://github.com/hesreallyhim/awesome-claude-code/blob/main/CONTRIBUTING.md).
- **Accepts tools like this?** Maybe. Fits categories "Observability & Monitoring > Usage & Cost", "Linting" or "Configuration". Rules: the resource must be at least 14 days old with active development (after 2026-10-26 for ctxsize) **or** have 100 stars; one resource at a time; descriptions written as descriptions, one line, no emoji, no sales pitch. Its checklist says "This resource is specific to Claude Code". ctxsize covers ten agents, so that box is only half true: say so in the description rather than tick it blindly, and expect the maintainer to decide.
- **How:** a human submits the web issue form <https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml>. **No PR, and not possible with the `gh` CLI** (the rules say so, and say AI-written resources are fine but the recommendation itself must be made by a person). The maintainer also says to build users first, then submit.
- Form fields:
  - Display Name: `ctxsize`
  - Category: `Observability & Monitoring > Usage & Cost`
  - Link: `https://github.com/Chiragjain7254/ctxsize`
  - Author Name: `Chirag Jain`; Author Link: `https://github.com/Chiragjain7254`
  - Description (10 to 500 characters): `Offline command-line tool that shows which instruction files, rules and skills Claude Code loads before the first prompt, how many tokens they cost (estimated), and what is cut off or ignored, such as an AGENTS.md next to a CLAUDE.md. Also covers Codex, Cursor, Copilot, Gemini CLI and five others. Gives a health grade from A to F, a share card and a CI check. Makes no network calls.`
- Issue title (the form sets it): `[Resource]: ctxsize`.

### 2. yzfly/awesome-context-engineering (about 212 stars)

- Link: <https://github.com/yzfly/awesome-context-engineering>, rules in [CONTRIBUTING.md](https://github.com/yzfly/awesome-context-engineering/blob/main/CONTRIBUTING.md).
- **Accepts tools like this?** Plausibly yes ("Tools & Libraries"; criteria: relevant to context engineering for LLMs or agents, high quality, public link, not a duplicate). There is no age or star rule, but "well-known, actively maintained, or otherwise valuable" is a judgement call.
- Must be added to **both** `README.md` and `README_CN.md` (keep them in sync). The closest section is "Production Tools" under "Tools & Projects"; entries look like `- **[Name](url)**: description`.
- Line (English): `- **[ctxsize](https://github.com/Chiragjain7254/ctxsize)**: Offline CLI that weighs the instruction files, rules and skills ten coding agents load at startup against each agent's documented limits, and shows what is cut off or ignored`
- Line (Chinese, check it with a native speaker before you send it): `- **[ctxsize](https://github.com/Chiragjain7254/ctxsize)**: 离线命令行工具，按各编码智能体官方文档中的限制，估算它们启动时加载的指令文件、规则和技能的 token 数，并指出被截断或忽略的内容`
- PR title: `Add ctxsize (offline token and limit checker for agent instruction files)`
- PR body:

  ```
  Adds ctxsize to "Production Tools" in README.md and README_CN.md.

  What it is: an offline CLI (MIT) that applies each coding agent's documented rules (Claude Code, Codex, Cursor,
  Copilot, Gemini CLI and others) to a repo and shows which instruction files, rules and skills load before the
  first prompt, how many tokens that is (estimated), and what gets cut off or ignored. It makes no network calls.

  Why it belongs: it is a context-engineering tool for the context that is loaded before the first message.
  I am the author. The repo is young (created 2026-10-12), so I understand if it is too early.
  Docs links for every limit it states are in src/profiles.ts; the method for the 50-repo study is in docs/STUDY.md.
  ```

## Not a fit (checked, do not submit)

| List | Why not |
| --- | --- |
| [jamesmurdza/awesome-ai-devtools](https://github.com/jamesmurdza/awesome-ai-devtools) (about 3,960 stars) | Its PR checklist starts with "The entry is a tool that uses AI". ctxsize does not use AI. The category "Configuration & Context Management" would fit the topic, but ticking that box would be untrue. |
| [bradagi/awesome-cli-coding-agents](https://github.com/bradagi/awesome-cli-coding-agents) (about 1,360) | Only terminal agents that "read/write code or run commands autonomously". ctxsize is not an agent. |
| [ai-for-developers/awesome-ai-coding-tools](https://github.com/ai-for-developers/awesome-ai-coding-tools) (about 2,170) | "AI-powered or AI-enhanced" tools only, with a sponsorship business around the list. |
| [PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) (about 40,900) | A collection of Cursor rule files, not tools. PRs from accounts younger than 30 days are blocked by CI. |
| [agarrharr/awesome-cli-apps](https://github.com/agarrharr/awesome-cli-apps) (about 20,500) | **Archived**: it no longer takes PRs. |
| [tairov/awesome-agents.md](https://github.com/tairov/awesome-agents.md) | **Archived** (last push 2025-10-23). |
| [Ischca/awesome-agents-md](https://github.com/Ischca/awesome-agents-md) (about 89) | Codex-focused, last updated 2025-08, and it asks contributors to review two other open PRs first. Only worth it if it is alive when you look. |
| [sindresorhus/awesome-nodejs](https://github.com/sindresorhus/awesome-nodejs) (about 67,100) | Needs more than 30 days **and** 100 stars, and says the bar for CLI tools is especially high. Revisit when ctxsize has the stars. |

## Before you submit anything

- Use the same wording as the README, and say you are the author.
- One list at a time; do not post the same text in several places on the same day.
- Never ask people to star the repo. If a list says no, say thank you and move on.
