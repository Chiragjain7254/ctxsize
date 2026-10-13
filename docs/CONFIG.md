# Configuration: `ctxsize.json`

ctxsize works without any config. Add a `ctxsize.json` at the repo root (or a `"ctxsize"` key in
`package.json`) to add your own tools, change what the built-in ones read, pick models, and set the
number of messages used for the cost estimate. If both files exist, `ctxsize.json` wins.

A typo in a key is an error (exit code 2), not a silent default.

```json
{
  "messages": 80,
  "tools": {
    "claude": { "model": "claude-haiku-5-5" },
    "zed": { "instructions": [".rules", "AGENTS.md"] },
    "acme": {
      "label": "Acme Agent",
      "model": "my-llama",
      "instructions": ["ACME.md", "docs/*.agent.md"],
      "search": "root-to-cwd",
      "rules": [{ "dir": ".acme/rules", "glob": "*.md", "modeKey": "trigger", "startupModes": ["always"] }],
      "skills": { "dirs": [".acme/skills"] },
      "limits": { "maxFileBytes": 32768, "maxTotalBytes": 65536 },
      "sources": [{ "url": "https://acme.example/docs/context", "checked": "2026-10-13" }]
    }
  },
  "models": {
    "my-llama": {
      "label": "My Llama",
      "contextTokens": 128000,
      "tokenizer": { "charsPerToken": 3.8 },
      "pricePer1MInput": 0.9
    },
    "claude-sonnet-5-5": { "pricePer1MInput": 2.5 }
  }
}
```

## `tools`

Each key is a tool id (lowercase letters, digits and dashes). Run `ctxsize --agents acme` to measure
just that tool.

- **A new id** defines a new tool. `label` is required, and at least one of `instructions`, `rules`
  or `skills`.
- **The id of a built-in data-driven tool** (`opencode`, `cline`, `windsurf`, `aider`, `zed`)
  overrides just the fields you give; the rest stay as built in.
- **The id of a tool with its own loader** (`claude`, `codex`, `cursor`, `copilot`, `gemini`) accepts
  only `model`: those loaders have rules too specific to describe as data.

| Field | Meaning |
| --- | --- |
| `label` | Name shown in reports. |
| `model` | Model id for this tool (see `models`). |
| `defaultContextTokens` | Window when the model does not set one. |
| `instructions` | File names or globs, relative to each searched folder. Plain names are matched with exact case. |
| `search` | Which folders are searched: `root-to-cwd` (default), `cwd`, `root`, or `nearest` (the closest folder to cwd that has a match, and only that one). |
| `firstMatchOnly` | In each folder only the first pattern that matches loads. |
| `nested` | Same-named files below cwd: `on-demand` (default) or `ignore`. |
| `instructionLoad` | `startup` (default) or `on-demand` (for files the user has to pass in, like Aider's conventions file). |
| `rules` | List of rule folders. `dir` (from the repo root), `glob` inside it (default: every `.md`), `load`, `modeKey` + `startupModes` (a frontmatter key such as `trigger` whose listed values load at startup) or `conditionalKey` (a frontmatter key such as `paths` that makes the rule on-demand). |
| `skills.dirs` | Folders holding `<skill>/SKILL.md`. Their name + description entries load at startup. |
| `limits` | `maxFileBytes`, `maxTotalBytes`, `maxFileChars`, `skillListingMaxBytes`, `skillDescriptionMaxChars`, `recommendedMaxLines`. |
| `sources` | `{ "url": "https://...", "checked": "YYYY-MM-DD" }` entries: where your numbers come from. |
| `notes` | Strings shown under the tool in reports. |

Paths and globs are relative to the repo, use `/`, and may not contain `..` or start with `/`, so a
config file cannot point outside the repo. Globs support `*`, `**`, `?` and `{a,b}`.

What the limits do:

- `maxFileBytes`: a startup file over this is cut (a `will` drop).
- `maxTotalBytes`: startup instruction files are read in order; the one that crosses the limit is
  cut and later ones are dropped (a `will` drop).
- `skillListingMaxBytes`: skills past this much listing text are left out (a `will` drop).
- `maxFileChars`, `skillDescriptionMaxChars`, `recommendedMaxLines`: reported, not applied
  (`at-risk` or `advice`), because docs usually name the size but not what happens past it.

## `models`

A model sets the context window, the tokenizer and the input price used for a tool. Built-in presets
are listed by `ctxsize --help`. An id that matches a preset overrides only the fields you give
(for example just the price). A new id needs `label`, `contextTokens` and `tokenizer`.

`tokenizer` is `"o200k_base"`, `"cl100k_base"`, or `{ "charsPerToken": 3.8 }` for models whose
tokenizer is not available here (Llama, Qwen, DeepSeek, ...). A ratio is a rough estimate: it divides
the characters of each file by the ratio.

`pricePer1MInput` is USD per million **uncached** input tokens. Presets carry the page and date their
numbers came from (`src/models.ts`). Prices change, so check them or override them.

Choosing a model, strongest first: `--model tool=id` (or `--model id` for all tools), then
`"model"` on the tool in this file, otherwise a default per tool, which reports mark with `*`.
`--context` overrides the window and `--price` overrides the price for every tool.

## `messages`

How many messages a session is assumed to have when the overhead is estimated
(overhead = startup tokens x messages). Default 50; `--messages` overrides it.

## One example per option

```json
{
  "messages": 100,
  "tools": {
    "acme": {
      "label": "Acme Agent",
      "model": "my-llama",
      "defaultContextTokens": 64000,
      "instructions": ["ACME.md", "docs/*.agent.md"],
      "search": "nearest",
      "firstMatchOnly": true,
      "nested": "ignore",
      "instructionLoad": "startup",
      "rules": [
        { "dir": ".acme/rules", "glob": "**/*.md", "conditionalKey": "paths" },
        { "dir": ".acme/modes", "modeKey": "mode", "startupModes": ["always"] }
      ],
      "skills": { "dirs": [".acme/skills"] },
      "limits": {
        "maxFileBytes": 32768,
        "maxTotalBytes": 65536,
        "maxFileChars": 12000,
        "skillListingMaxBytes": 51200,
        "skillDescriptionMaxChars": 1024,
        "recommendedMaxLines": 500
      },
      "sources": [{ "url": "https://acme.example/docs", "checked": "2026-10-13" }],
      "notes": ["Global rules in ~/.acme are not read."]
    },
    "aider": { "instructionLoad": "startup" },
    "codex": { "model": "gpt-5.3-codex" }
  },
  "models": {
    "my-llama": {
      "label": "My Llama",
      "contextTokens": 128000,
      "tokenizer": { "charsPerToken": 3.8 },
      "pricePer1MInput": 0.9
    },
    "claude-sonnet-5-5": { "pricePer1MInput": 2.5 }
  }
}
```

- `aider` with `instructionLoad: "startup"`: count `CONVENTIONS.md` because you always pass it with `--read`.
- `codex` with only `model`: built-in tools with their own loader accept nothing else.
- `claude-sonnet-5-5` with only a price: keeps the built-in window and tokenizer.

## Command-line options that override the file

| Option | Overrides |
| --- | --- |
| `--messages 50` | `messages` |
| `--model claude-haiku-5-5` or `--model codex=gpt-5.3-codex,claude=claude-haiku-5-5` | each tool's `model` |
| `--context 200000` | the context window of every tool |
| `--price 3` | the input price (USD per 1M tokens) of every tool |
| `--agents claude,acme` | which tools run (built-in and your own) |
