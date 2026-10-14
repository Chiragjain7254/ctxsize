# Progress

Now working on: 12 of 12 (blocked: 3, npm publish needs a real 2FA code)

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
- [ ] 12. Add `--serve` live report server and `--open` for `--html`

Standing rule: no Co-Authored-By, Claude-Session or "Generated with Claude Code" in any commit, PR or release.
