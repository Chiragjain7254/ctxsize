# Contributing

Thanks for helping. The most valuable contribution is keeping agent limits correct.

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

## Agent limits changed?

All documented limits live in `src/profiles.ts`, each with a source URL and the date it was
checked. Update the number, the URL and the date together, and add a CHANGELOG line. A claim about how
an agent behaves needs a link to its official docs. `npx @chiragjain7254/ctxsize --check-profiles` lists
them all. To add a whole agent, see "How to add a new agent" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
