# Contributing

Thanks for helping. The most valuable contribution is keeping agent limits correct.

## Setup

```sh
npm ci
npm run check   # lint, typecheck, tests, build
npm run dev -- path/to/repo
```

Node 22.12 or newer. Works on macOS, Windows and Linux; CI runs all three.

## Agent limits changed?

All documented limits live in `src/profiles.ts`, each with a source URL and the date it was
checked. Update the number, the URL and the date together, and add a CHANGELOG line.

## Pull requests

- One logical change per commit, message says why.
- Add or update a test with each behaviour change. Fixtures live in `test/fixtures/`.
- Run `npm run format` before pushing.
