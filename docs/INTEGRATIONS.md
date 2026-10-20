# Integrations

Ways to run ctxsize automatically, from the smallest (a script) to the one that watches every pull request.
All of them only read files in your repo: ctxsize makes no network calls and sends nothing anywhere. Token
counts are estimates.

Pick the budget (`8000` below) after you have looked at your own numbers: run `npx @chiragjain7254/ctxsize`, or
let `npx @chiragjain7254/ctxsize init --workflow` suggest one 25% above what your repo loads today.

## npm script

Install it once as a dev dependency, then it also works offline:

```sh
npm install --save-dev @chiragjain7254/ctxsize
```

```json
{
  "scripts": {
    "ctxsize": "ctxsize --quiet --max-tokens 8000",
    "ctxsize:report": "ctxsize --serve"
  }
}
```

`npm run ctxsize` prints one summary line and exits `1` when an agent loads more than 8,000 tokens at startup.
The exit codes are in [CLI.md](CLI.md#exit-codes).

## Plain git hook

Save this as `.git/hooks/pre-commit` and make it executable (`chmod +x .git/hooks/pre-commit`). It runs only when
you staged a file that an agent reads, so ordinary commits stay fast:

```sh
#!/bin/sh
# Block a commit when an agent would load more than 8,000 tokens before the first prompt.
changed=$(git diff --cached --name-only)
if echo "$changed" | grep -Eq '(^|/)(AGENTS|CLAUDE|GEMINI)(\.override)?\.md$|(^|/)\.(claude|cursor|clinerules|windsurf)/|\.github/copilot-instructions\.md$|(^|/)SKILL\.md$'; then
  npx --no-install ctxsize --quiet --max-tokens 8000 || {
    echo "ctxsize: an agent loads too much. Run 'npx ctxsize' to see which file." >&2
    exit 1
  }
fi
```

`--no-install` uses the copy from your dev dependency and never downloads anything. Without that
dependency, replace it with `npx @chiragjain7254/ctxsize`. On Windows, Git for Windows runs this hook in its own
shell, so the same file works. Skip it once with `git commit --no-verify`.

## Husky

With [Husky](https://typicode.github.io/husky/) (v9) the same hook lives in the repo, so the whole team gets it:

```sh
npm install --save-dev husky @chiragjain7254/ctxsize
npx husky init
```

Then put this in `.husky/pre-commit` (a plain shell file; remove the sample line `npm test` if you do not want it):

```sh
npm run ctxsize
```

That runs the npm script from the section above on every commit. To run it only when an instruction file
changed, use the body of the plain git hook instead.

## VS Code task

Add a task to `.vscode/tasks.json` and run it from **Terminal → Run Task**, or bind it to a key:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "ctxsize: what do my agents read?",
      "type": "shell",
      "command": "npx @chiragjain7254/ctxsize",
      "problemMatcher": [],
      "presentation": { "reveal": "always", "panel": "dedicated" }
    },
    {
      "label": "ctxsize: live report",
      "type": "shell",
      "command": "npx @chiragjain7254/ctxsize --serve",
      "isBackground": true,
      "problemMatcher": []
    }
  ]
}
```

The second task serves the report at `http://localhost:4321` and keeps it up to date while you edit
`AGENTS.md`. Stop it with the trash icon on its terminal.

## GitHub Action

The shortest way to guard pull requests:

```yaml
name: ctxsize
on: pull_request

permissions:
  contents: read

jobs:
  ctxsize:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: Chiragjain7254/ctxsize@v0.2.0
        with:
          max-tokens: 8000
```

`npx @chiragjain7254/ctxsize init --workflow` writes this file for you, with a budget picked from your repo.
Inputs, a pull request comment and the exit codes are in [CI.md](CI.md).

## A badge for your README

```sh
npx @chiragjain7254/ctxsize --badge
```

prints a Markdown badge with your grade and startup tokens. It is a static image: run it again when you want it
to change. The grade is explained in [GRADE.md](GRADE.md).
