# Using ctxsize in CI

Two things are worth doing on every pull request: fail the build when an agent's startup load grows past a
budget, and show the numbers in a pull request comment so reviewers see what a change costs.

ctxsize never runs an agent and never uses the network, so it needs no secrets.

## Fail the build over a budget

```yaml
name: ctxsize
on: pull_request

permissions:
  contents: read

jobs:
  budget:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - run: npx @chiragjain7254/ctxsize --quiet --max-tokens 8000
```

`--quiet` keeps the log to one summary line. If an agent loads more than 8,000 tokens at startup, ctxsize names it
on stderr and exits `1`, and the job fails. The other gates work the same way:

| Flag | Fails when |
| --- | --- |
| `--max-tokens <n>` | any agent loads more than `n` tokens at startup |
| `--max-percent <n>` | any agent uses more than `n`% of its context window at startup |
| `--fail-on-warnings` | a `!` check fires: duplicated instructions, a skill with no description |
| `tools.<id>.maxTokens` in `ctxsize.json` | that one tool is over its own budget |

Limit it to the agents your team uses with `--agents claude,codex`. A tool you do not use then cannot fail the
build. Pin the version (`npx @chiragjain7254/ctxsize@0.1.0`) if you want identical results until you upgrade.

## Comment the numbers on the pull request

`--markdown <file>` writes a short summary table. The step that posts it runs even when the gate fails, so the
comment is there exactly when the reviewer needs it:

```yaml
name: ctxsize
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  budget:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - name: Measure and check the budget
        run: npx @chiragjain7254/ctxsize --quiet --max-tokens 8000 --markdown "$RUNNER_TEMP/ctxsize.md"
      - name: Comment on the pull request
        if: always()
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh pr comment "${{ github.event.pull_request.number }}" --edit-last --create-if-none --body-file "$RUNNER_TEMP/ctxsize.md"
```

`--edit-last --create-if-none` updates the same comment on every push instead of adding a new one each time.

The comment looks like this:

```text
### ctxsize: what each agent loads before the first prompt

| Tool | Model | Startup tokens | % of window | Overhead cost | Dropped |
| --- | --- | ---: | ---: | ---: | ---: |
| Claude Code | Claude Sonnet 5.5* | 399 | <0.1% | $0.0399 | - |
```

Pull requests from forks get a read-only token, so the comment step cannot post there. Add
`continue-on-error: true` to that step, or print the table in the log with `--markdown -` instead.

## Show the change a pull request makes

`--diff <ref>` adds a comparison with another commit. It needs history, so check out with `fetch-depth: 0`:

```yaml
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - run: npx @chiragjain7254/ctxsize --diff "origin/${{ github.base_ref }}" --max-tokens 8000
```

## Keep the report

```yaml
      - run: npx @chiragjain7254/ctxsize --quiet --json > ctxsize.json
      - uses: actions/upload-artifact@v5
        with:
          name: ctxsize-report
          path: ctxsize.json
```

The JSON format is described by [report.schema.json](report.schema.json). Set `SOURCE_DATE_EPOCH` if you want
the `generatedAt` time to be the same on every run.

## Exit codes

`0` passed, `1` a gate failed, `2` a usage error (a bad flag or `ctxsize.json`). See
[the exit codes](CLI.md#exit-codes).
