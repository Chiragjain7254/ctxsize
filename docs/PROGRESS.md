# Progress

Now working on: 3 of 12 (blocked: npm publish needs a real 2FA code)

- [x] 1. Rewrote the last 7 commits to drop Co-Authored-By; force-pushed main, v0.2-dev and the v0.1.0 tag
- [x] 2. Add the "Progress tracking" rule to AGENTS.md and write this file
- [ ] 3. Publish v0.1.0 to npm, check `npx @chiragjain7254/ctxsize@latest --version` in a clean folder, remove the "not published yet" notes
- [x] 4. Fix the v0.1.0 GitHub release so it shows on the Releases page
- [x] 5. Respect .gitignore when walking; always skip node_modules, dist, build, .git; test with a large ignored folder
- [x] 6. Mark non-OpenAI token counts as estimates in terminal, JSON and HTML output
- [x] 7. Add `ctxsize --check-profiles` (every limit with source URL and checked date)
- [ ] 8. Final pass: CI is green on main and no temp files are tracked; still to do: re-check docs after the npm publish

- [x] 10. Add `--open` to open the HTML report in the browser
- [x] 9. Add CLI reference, architecture and release docs; expand CONTRIBUTING; add README troubleshooting
- [x] 11. Hide agents with no files by default; add `--all`
- [x] 12. Add `--serve` live report server and `--open` for `--html`

Standing rule: no Co-Authored-By, Claude-Session or "Generated with Claude Code" in any commit, PR or release.

## v0.2.0 pre-release audit

- [x] Run every flag and combination against five targets (examples, secret-word, empty, no git, shallow next.js)
- [x] Exercise `--serve` (/, /api/report, /events, live update), `--watch`, `--html --open` (mocked), `--mcp`
- [x] Test the GitHub Action and the PR-comment recipe on a real PR (PR #4, closed, branch deleted)
- [x] `npm run check` 5 times in a row: 5 of 5 passed, no flaky tests
- [x] Fix: stack trace when an output file path cannot be written
- [x] Fix: "1 commits" in the history heading
- [ ] Publish 0.2.0 to npm: the action and the PR-comment recipe call `ctxsize --quiet`, which the published 0.1.0 does not have
