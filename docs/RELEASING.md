# Releasing

Steps for publishing a new version of ctxsize to npm. Only the owner publishes.

## Package name

The package is published as **`@chiragjain7254/ctxsize`**, not `ctxsize`. npm rejected the plain name
`ctxsize` as too similar to the existing package `ctx-size`. The command that users run is still
`ctxsize` (the `bin` entry in `package.json`).

## Steps

Run the commands from the repo root. Replace `X.Y.Z` with the new version.

1. **Bump the version.** Set `"version"` in `package.json` to `X.Y.Z`. To keep `package-lock.json` in sync,
   let npm do it without making a commit or tag:

   ```sh
   npm version X.Y.Z --no-git-tag-version
   ```

   Also set `VERSION` in `src/version.ts` to the same number. It is a separate constant, and it is what
   `ctxsize --version` and the reports show. Nothing checks that the two match, so compare them yourself.

2. **Update `CHANGELOG.md`.** Add a `## [X.Y.Z] - YYYY-MM-DD` section above the previous one, with
   Added / Changed / Fixed lists. Note any change in agent limits.

3. **Run the checks.** They must pass:

   ```sh
   npm run check
   ```

   This runs lint, typecheck, tests and the build.

4. **Commit.** Use a clear message and only project files, for example `Release X.Y.Z`.

5. **Push** the branch:

   ```sh
   git push
   ```

   Wait for CI to pass on Linux, macOS and Windows.

6. **Publish to npm, in your own PowerShell.** It needs approval in the browser, so the agent cannot do it
   for you:

   ```powershell
   npm.cmd publish
   ```

   `publishConfig.access` is `public`, so no extra flag is needed for the scoped name. Use `npm.cmd`, not
   `npm`, so that PowerShell's script policy does not block it.

7. **Create the git tag after the final commit.** If you make any further commit, create the tag only after
   it. Never move a tag that was already pushed (`v0.1.0` stays where it is).

   ```sh
   git tag vX.Y.Z
   ```

8. **Push the tag:**

   ```sh
   git push origin vX.Y.Z
   ```

9. **Verify the published package.**

   ```sh
   npm view @chiragjain7254/ctxsize version
   ```

   It should print `X.Y.Z`. Then run it from an empty folder, so no local install interferes:

   ```sh
   cd "$(mktemp -d)"
   npx @chiragjain7254/ctxsize@latest --version
   ```

   In PowerShell, make a new empty folder and `cd` into it first. The command should print `X.Y.Z`. If it
   prints an older version, see "npx cache issues" in the README's Troubleshooting section.

## Publishing from GitHub Actions

`.github/workflows/release.yml` can do steps 6 to 9 for you. It runs **only** when a tag starting with `v` is
pushed, never on a branch push or a pull request. It:

1. checks out the tag and runs `npm ci`,
2. checks that the tag, `package.json` and `src/version.ts` name the same version (`v0.2.0` needs `0.2.0` in both),
3. runs `npm run check`,
4. runs `npm publish --provenance --access public`, which signs a provenance statement so npm can show where the
   package was built.

One-time setup, in your own browser:

1. On npmjs.com, create an **automation** access token that can publish `@chiragjain7254/ctxsize`.
2. In the GitHub repository, add it as the secret `NPM_TOKEN` (Settings, Secrets and variables, Actions).

Then a release is steps 1 to 5 above, followed by `git tag vX.Y.Z` and `git push origin vX.Y.Z`. Watch the run with
`gh run watch`. Do not push a tag until the commit it points at has a green CI run, and never move a tag that was
already pushed: a version can be published only once. If the guard step fails, delete the tag locally and on
GitHub (`git push origin :refs/tags/vX.Y.Z`), fix the version, and tag again before anything was published.

Publishing by hand (step 6) still works. Use one way or the other for a given version, not both.

## If something goes wrong

- A version number can be published only once. If the publish fails after the version was used, bump to
  the next patch version and release again.
- If `npm run check` fails, fix it and make a new commit before step 4; do not tag a broken commit.
