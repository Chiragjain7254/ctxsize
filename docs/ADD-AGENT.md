# Add a new agent in 15 minutes

ctxsize describes most coding agents as data: which files it reads, when, and what limits apply. Adding one
means a short entry in `src/profiles.ts`, a test and a few doc lines. No new loader code.

This guide was checked by following it on a fresh clone with a throwaway "Demo Agent": install, entry, test,
`npm run check` took under 15 minutes, and the two tests that need a new line are named below.

**Before you start:** the agent needs official docs that say which files it reads. ctxsize states only what an
official page says; where the docs are silent, it says "not documented" instead of guessing. If you only want to
try an agent on your own repo, you do not need a pull request: describe it in
[`ctxsize.json`](CONFIG.md) (same fields, no code).

## 1. Set up (2 minutes)

```sh
git clone https://github.com/Chiragjain7254/ctxsize.git
cd ctxsize
npm ci
npm run check        # everything is green before you change anything
git switch -c add-<agent>
```

Needs Node 22.12 or newer. Not sure about a step? Open a draft pull request early and ask.

## 2. Read the docs and write down the answers (5 minutes)

Open the agent's official page about instruction files, rules and skills. Note, with the link and today's date:

| Question | Becomes |
| --- | --- |
| Which file names does it read (`AGENTS.md`, its own file)? | `instructions` |
| Does it search from the repo root down, only the current folder, or up from it? | `search`: `root-to-cwd` (default), `cwd`, `root`, `nearest` |
| Does it read only the first match in a folder? | `firstMatchOnly` |
| Are there rule folders? Which file types? Do some rules load only for some files? | `rules` (`dir`, `glob`, `modeKey`, `conditionalKey`) |
| Are there skills? Where do they live? | `skills.dirs` |
| Does the docs state a size limit (bytes, characters, lines) or a context window? | `limits`, `defaultContextTokens` |

The full list of fields is in `ToolSpec` in [`src/core/types.ts`](../src/core/types.ts). Anything the docs do not
say goes in `notes`, never in a guess.

## 3. Add the profile (3 minutes)

Add an entry at the end of `specProfiles` in [`src/profiles.ts`](../src/profiles.ts) (the order is the order agents are listed):

```ts
  example: {
    label: 'Example Agent',
    instructions: ['AGENTS.md'],
    search: 'root',
    nested: 'ignore',
    rules: [{ dir: '.example/rules', glob: '*.md' }],
    sources: [
      {
        url: 'https://example.com/docs/instructions',
        checked: CHECKED,
        note: 'what this page says, in a few words',
      },
    ],
    notes: ['Anything the docs leave open.'],
  },
```

(This is only the shape: use what the docs you read say.) The id (`example`) is what
people type after `--agents`. Set `CHECKED` (top of the file) to the day you read the docs. Try it at once:

```sh
npm run dev -- path/to/a/repo --agents example
```

## 4. Add the tests (3 minutes)

1. In [`test/tools.test.ts`](../test/tools.test.ts), add a test next to the others: build a small fake repo with
   `tmpRepo()` (see `test/helpers.ts`), run the agent on it and check which files load and when. Write one that
   fails without your entry. Also add the id at the end of the list in "there are ten built-in tools" (and fix the number in its name if you like).
2. In [`test/history.test.ts`](../test/history.test.ts), add one file your agent reads to the `files` object in
   "every built-in tool sees at a commit what it sees in the working tree".

Run them:

```sh
npx vitest run test/tools.test.ts test/history.test.ts
```

## 5. Update the docs (2 minutes)

- The agent's row in [`docs/tools.md`](tools.md) (files, limits, docs links).
- The agent list in [`docs/FEATURES.md`](FEATURES.md) and the "Features" list in the [README](../README.md).
- `npm run verify:gen` adds the agent to the predictions table in [`docs/VERIFY.md`](VERIFY.md). Leave its
  "Observed" column as "not yet tested" unless you ran the fruit test yourself.
- One line under "Added" in [`CHANGELOG.md`](../CHANGELOG.md).

## 6. Check and open the pull request

```sh
npm run format       # Biome fixes the layout
npm run check        # lint, typecheck, tests, build
```

Open the pull request against `main` and fill in the template. Mention the agent's version and the docs page.

## Optional but the most valuable: the fruit test

Copy [`examples/secret-word`](../examples/secret-word) outside any repo, run `git init` there, open the real agent
and ask the question in [VERIFY.md](VERIFY.md). Compare the fruits it names with what ctxsize predicted, and put
the result in the pull request. A prediction nobody checked is a guess; one that matches is evidence.

## When a hand-written loader is needed

If the agent's rules cannot be described by `ToolSpec` (for example it imports other files, or has its own
config format), see "Hand-written loader" in [ARCHITECTURE.md](ARCHITECTURE.md#how-to-add-a-new-agent) and open an
issue first so we can talk it through.
