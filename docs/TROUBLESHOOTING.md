# Troubleshooting

**"Unsupported engine" or a syntax error on start.** Your Node is too old. ctxsize needs Node 22.12 or newer. Check with `node --version`, then install a current version from [nodejs.org](https://nodejs.org/).

**`npx` runs an old version.** `npx` caches packages. Ask for the newest one explicitly:

```sh
npx @chiragjain7254/ctxsize@latest --version
```

If that still shows an old number, clear the cache with `npm cache clean --force` and try again. A globally installed copy (`npm install -g`) is not updated by `npx`; update it with `npm install -g @chiragjain7254/ctxsize@latest`.

**Windows.**
- In PowerShell, if `npm` or `npx` is blocked by the script execution policy, run `npm.cmd` / `npx.cmd` instead.
- Paths in the report always use `/`, even on Windows.
- Quote paths that contain spaces: `npx @chiragjain7254/ctxsize "C:\My Projects\app"`.

**"not a directory" or an unknown agent.** Pass one existing folder, and use ids from `ctxsize --help` for `--agents`.

**The page says "No agent files found".** No coding agent reads any file in that folder yet. Add an `AGENTS.md` (or a `CLAUDE.md` for Claude Code) to the root of your project and run ctxsize again.

**`--serve` shows an old page, or a different port than I expected.** If the port is busy (maybe an older `ctxsize --serve` is still running), ctxsize takes the next free one and prints the address. Open the address it prints, or stop the old one with Ctrl+C.

**Something else?** [Open an issue](https://github.com/Chiragjain7254/ctxsize/issues/new/choose).
