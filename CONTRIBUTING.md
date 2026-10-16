# Contributing

Welcome, and thank you for being here.

ctxsize started as one person's frustration: I could not see why my coding agent ignored instructions I had written, and [Claude Code issue #6235](https://github.com/anthropics/claude-code/issues/6235) shows I was not the only one (over 5,000 thumbs-up). Your agent, your repo and your ideas make it better, and ideas that change the direction of the project are welcome too. — Chirag

## Your first PR in 10 minutes

You need Node 22.12 or newer and git. ctxsize works on macOS, Windows and Linux, and CI runs all three.

1. **Clone** (fork first if you do not have access):

   ```sh
   git clone https://github.com/Chiragjain7254/ctxsize.git
   cd ctxsize
   ```

2. **Install and check that everything passes** before you change anything:

   ```sh
   npm ci
   npm run check   # lint, typecheck, tests, build
   ```

3. **Pick something small.** A [good first issue](https://github.com/Chiragjain7254/ctxsize/labels/good%20first%20issue) names the file to start in. Say so in the issue so two people do not do the same thing.
4. **Make your change**, with a test. Run it from source on any repo: `npm run dev -- path/to/repo --agents claude --json`.
5. **Run `npm run check` again, then open the pull request** against `main` and fill in the template. CI runs lint, typecheck, tests and the build on Linux, macOS and Windows with Node 22 and 24; all of it must be green.

Stuck? Open the issue or the draft pull request anyway and ask. A half-finished PR with a question is welcome.

## Add or update an agent

Tools change their rules often, and a profile that is out of date misleads everyone. If an agent loads different files than ctxsize predicts, [open an issue](https://github.com/Chiragjain7254/ctxsize/issues/new?template=agent-behavior-changed.yml), or send the fix:

1. **Update `src/profiles.ts`** (or the loader in `src/agents/`). Match the official docs, and never hard-code a limit anywhere else.
2. **Add the docs link** to that agent's `sources`. A claim about how an agent behaves needs a link to its official docs. If the docs are silent, say so in the agent's `notes` instead of guessing.
3. **Set the checked date** (`CHECKED`, or the source's `checked`) to the day you read the docs.
4. **Add a test** in `test/agents/` or `test/profiles.test.ts` that fails without your change.
5. **Run the fruit test on the real agent.** Copy `examples/secret-word` outside any repo, run `git init` there, open the agent in a new session and ask exactly the question in [docs/VERIFY.md](docs/VERIFY.md). Note which fruits it names and the agent's version. If a file behaves differently now, change the fruit files in `examples/secret-word/` to match.
6. **Regenerate the docs and add a CHANGELOG line:**

   ```sh
   npm run verify:gen   # rewrites the predicted columns in docs/VERIFY.md from ctxsize's real output
   npm run study        # re-runs the 50-repo study (needs git and the gh CLI signed in)
   ```

   Then fill in the "Observed (date, agent version)" and "Match?" cells of that agent's row in `docs/VERIFY.md` by hand. Never write an observed result you did not see. `npm run study` clones 50 repositories, so a pull request does not have to include it; say in the pull request that the study needs a re-run.

To add a whole new agent, follow [docs/ADD-AGENT.md](docs/ADD-AGENT.md) (about 15 minutes); the details are in "How to add a new agent" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Where the project is going: [ROADMAP.md](ROADMAP.md). `npx @chiragjain7254/ctxsize --check-profiles` lists every limit with its source and date.

## What's in this repo

- `src/`: the CLI. `src/agents/` has one loader per agent, `src/profiles.ts` every documented limit (with its source and checked date), `src/report/` the terminal, JSON and HTML output.
- `test/`: Vitest tests. `test/fixtures/` holds tiny fake repos.
- `docs/`: the guides, the glossary (generated), the study and the images in `docs/img/`.
- `examples/`: `secret-word`, a small repo you use to check what an agent really reads (see [docs/VERIFY.md](docs/VERIFY.md)). It is also a test fixture.
- `scripts/`: maintainer scripts (the glossary, the screenshots, the study, the secret-word generator).
- `.github/`: CI, the release workflow, and issue and pull request templates.

For how the code fits together, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Every flag is in [docs/CLI.md](docs/CLI.md).

## Good first issues

These are small, self-contained changes, each with the files to touch and how to test:

- [#6 Count Cursor's agent-requested rule descriptions at startup](https://github.com/Chiragjain7254/ctxsize/issues/6)
- [#7 Recognize a lowercase agents.md for Windsurf](https://github.com/Chiragjain7254/ctxsize/issues/7)
- [#8 Add a JSON Schema for --history --json](https://github.com/Chiragjain7254/ctxsize/issues/8)
- [#9 Give a crash its own exit code, apart from a failed gate](https://github.com/Chiragjain7254/ctxsize/issues/9)
- [#10 Check Zed's profile against the stable docs](https://github.com/Chiragjain7254/ctxsize/issues/10)
- [#12 Add a profile for a coding agent ctxsize does not cover yet](https://github.com/Chiragjain7254/ctxsize/issues/12)
- [#13 Write the ctxsize summary to the GitHub job summary in the Action](https://github.com/Chiragjain7254/ctxsize/issues/13)
- [#14 Suggest the forward-slash form when --exclude is given backslashes](https://github.com/Chiragjain7254/ctxsize/issues/14)
- [#15 Test that the PNG card's pixel font is complete](https://github.com/Chiragjain7254/ctxsize/issues/15)
- [#16 Add the grade to the glossary and its hover help](https://github.com/Chiragjain7254/ctxsize/issues/16)

More are listed under the [`good first issue` label](https://github.com/Chiragjain7254/ctxsize/labels/good%20first%20issue) as they come up.

## Running tests and code style

Tests use [Vitest](https://vitest.dev/):

```sh
npm test                                   # run everything once
npx vitest run test/agents/gemini.test.ts  # one file
npx vitest                                 # watch mode while you work
```

- Add or update a test with every behaviour change.
- Build small fake repos with `tmpRepo()` from `test/helpers.ts`, or put one in `test/fixtures/` (one per behaviour under test). Tests never read your real home folder; use `fakeHome()`.
- Tests must pass on Windows and Linux. Use `node:path` and compare POSIX-style relative paths.

Formatting and linting are done by [Biome](https://biomejs.dev/) (see `biome.json`): 2 spaces, single quotes, lines up to 100 characters, imports sorted. `npm run lint` checks, `npm run format` fixes. Write code that looks like the code around it, and label token counts as estimates.

## Pull request checklist

- [ ] `npm run check` passes (lint, typecheck, tests, build).
- [ ] One logical change per commit; the message says why.
- [ ] A test covers the change.
- [ ] The docs are updated if a flag or behaviour changed, and the CHANGELOG has a line if users will notice.
- [ ] A claim about an agent links to its official docs in `src/profiles.ts`, with the checked date.
- [ ] No temporary or local-only files (keep them in `.local/`, which git ignores).

Address review comments with new commits. Releases are made by the maintainer; see [docs/RELEASING.md](docs/RELEASING.md).
