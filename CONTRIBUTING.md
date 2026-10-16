# Contributing

Thanks for helping. The most valuable contribution is keeping agent limits correct.

## What's in this repo

- `src/`: the CLI. `src/agents/` has one loader per agent, `src/profiles.ts` every documented limit (with its source and checked date), `src/report/` the terminal, JSON and HTML output.
- `test/`: Vitest tests. `test/fixtures/` holds tiny fake repos.
- `docs/`: the guides, the glossary (generated), the study and the screenshots in `docs/img/`.
- `examples/`: `secret-word`, a small repo you use to check what an agent really reads (see [docs/VERIFY.md](docs/VERIFY.md)). It is also a test fixture.
- `scripts/`: maintainer scripts (the glossary, the screenshots, the study, the secret-word generator).
- `.github/`: CI, the release workflow, and issue and pull request templates.

## Setup

You need Node 22.12 or newer and git. ctxsize works on macOS, Windows and Linux; CI runs all three.

```sh
git clone https://github.com/Chiragjain7254/ctxsize.git
cd ctxsize
npm ci
npm run check   # lint, typecheck, tests, build
npm run dev -- path/to/repo
```

`npm run dev -- <dir>` runs the CLI from source with any flag, for example
`npm run dev -- . --agents claude --json`. For how the code is organised, read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Every flag is in [docs/CLI.md](docs/CLI.md).

## Running tests

Tests use [Vitest](https://vitest.dev/).

```sh
npm test                                   # run everything once
npx vitest run test/agents/gemini.test.ts  # one file
npx vitest                                 # watch mode while you work
```

- Add or update a test with every behaviour change.
- Build small fake repos with `tmpRepo()` from `test/helpers.ts`, or put one in `test/fixtures/` (one per
  behaviour under test). Tests never read your real home folder; use `fakeHome()`.
- Tests must pass on Windows and Linux. Use `node:path` and compare POSIX-style relative paths.

## Code style

Formatting and linting are done by [Biome](https://biomejs.dev/) (see `biome.json`): 2 spaces, single
quotes, lines up to 100 characters, imports sorted.

```sh
npm run lint      # check only
npm run format    # fix what can be fixed automatically
npm run typecheck # TypeScript
```

Write code that looks like the code around it. Use `node:path`, never a hard-coded `/` or `\`. Label token
counts as estimates.

## Keeping agent profiles up to date

Tools change their rules often, and a profile that is out of date misleads everyone. If you notice an
agent loading different files than ctxsize predicts, [open an issue](https://github.com/Chiragjain7254/ctxsize/issues/new?template=agent-behavior-changed.yml)
or send a pull request.

**1. Update the profile.** Edit `src/profiles.ts` (or the loader in `src/agents/`):

- Change the number or behaviour to match the official docs, and add the doc link to that agent's `sources`.
- Set `CHECKED` (or the source's `checked` date) to the day you read the docs.
- Add or change a test in `test/agents/` or `test/profiles.test.ts` that fails without your change.
- If the docs are silent or unclear, say so in the agent's `notes` instead of guessing.

**2. Run the secret-word test on the real agent.** Copy `examples/secret-word` outside any repo, run
`git init` there, open the agent in a new session and ask exactly the question in
[docs/VERIFY.md](docs/VERIFY.md). Note the fruits it names and the agent's version. If you changed
what a file does, change the fruit files in `examples/secret-word/` to match.

**3. Regenerate the docs.**

```sh
npm run verify:gen   # rewrites the predicted columns in docs/VERIFY.md from ctxsize's real output
npm run study        # re-runs the 50-repo study and rewrites docs/study/results.json and docs/STUDY.md
```

Then fill in the "Observed (date, agent version)" and "Match?" cells of that agent's row in
`docs/VERIFY.md` by hand. `verify:gen` keeps what you wrote there. Never write an observed result you
did not see. A test fails if the predicted columns drift from ctxsize's output.
`npm run study` clones 50 repositories and needs the `gh` CLI signed in, so a pull request does not
have to include it; say in the pull request that the study needs a re-run.

**4. Run `npm run check`, add a CHANGELOG line, and open the pull request.**

## Agent limits changed?

All documented limits live in `src/profiles.ts`, each with a source URL and the date it was
checked. Update the number, the URL and the date together, and add a CHANGELOG line. A claim about how
an agent behaves needs a link to its official docs. `npx @chiragjain7254/ctxsize --check-profiles` lists
them all. To add a whole agent, see "How to add a new agent" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Good first issues

Small, self-contained changes that exist because of how the code is today. Each one names the file to start in.
Pick one, say so in an issue so two people do not do the same thing, and follow "Pull requests" below.

1. **Count Cursor's agent-requested rule descriptions at startup.** A `.mdc` rule with a `description` but no
   `alwaysApply` or `globs` is "Apply Intelligently": the agent decides from its description whether to load it.
   `src/agents/cursor.ts` (`ruleMode`) counts the whole rule as on-demand and nothing at startup, and a comment
   there says the description listing is not counted yet. First confirm in
   [Cursor's rules docs](https://cursor.com/docs/context/rules) that the description is in context at startup; if
   it is, add a startup item for it, like a skill's listing entry, with a test in `test/agents/cursor.test.ts`, and
   update `profiles.cursor`. If the docs do not say, record that as a note instead.
2. **Recognize a lowercase `agents.md` for Windsurf.** The [Windsurf AGENTS.md docs](https://docs.devin.ai/desktop/cascade/agents-md)
   say both `AGENTS.md` and `agents.md` are recognized, but `specProfiles.windsurf` in `src/profiles.ts` lists only
   `AGENTS.md`, and instruction names match with exact case. List both names and add a test in `test/tools.test.ts`
   (use two files with different names; case-insensitive file systems cannot hold both).
3. **A JSON Schema for `--history --json`.** `docs/report.schema.json` covers `--json` only, and the history output
   (written in `runHistory` in `src/run.ts`) has its own shape. Write `docs/history.schema.json` and a test next to
   `test/report-schema.test.ts` that validates real output, then link it from `docs/CLI.md`.
4. **Give a crash its own exit code.** `docs/CLI.md` says an unexpected error exits `1`, the same code as a failed
   gate, so CI cannot tell them apart. In `src/cli.ts`, catch what `run()` throws, print
   `ctxsize: unexpected error: <message>` with a link to the bug template, and exit with a new code (for example
   `3`). Put the code in `EXIT` in `src/run.ts`, document it, and test it in `test/exit-codes.test.ts`.
5. **Check Zed's stable docs.** `specProfiles.zed` is based on the *preview* docs because the stable rules page could
   not be fetched (see its note). Open [zed.dev/docs/ai/rules](https://zed.dev/docs/ai/rules), compare the list of
   files and the first-match rule, and either move the sources to the stable page (new `checked` date) or note what
   differs. Run `ctxsize --check-profiles` to see the current values.

Issues labelled `good first issue` list more as they come up.

## Pull requests

1. Fork the repo (or create a branch if you have access) and branch from `main`.
2. Make one logical change per commit. The message says why.
3. Run `npm run check`. It must pass.
4. Update the CHANGELOG if users will notice the change, and the docs if a flag or behaviour changed.
5. Push and open a pull request against `main`. Fill in the template: what and why, how you tested it, and
   the checklist.
6. CI runs lint, typecheck, tests and the build on Linux, macOS and Windows with Node 22 and 24. All of it
   must be green before merging.
7. Address review comments with new commits.

Do not commit temporary or local-only files. Keep them in `.local/`, which git ignores.

Releases are made by the maintainer; see [docs/RELEASING.md](docs/RELEASING.md).
