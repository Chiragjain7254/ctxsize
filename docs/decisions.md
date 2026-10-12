# Decisions

- 2026-10-12 Name `ctxsize`: free on npm and PyPI; only an empty 1-star GitHub repo shares it.
- 2026-10-12 TypeScript on Node: `npx ctxsize` is one command on every OS, and the v0.2 GitHub Action runs Node natively.
- 2026-10-12 Node >= 22.12: Node 20 reached end of life in April 2026; 22 and 24 are the live LTS lines.
- 2026-10-12 npm, not pnpm: no extra install step for contributors or CI.
- 2026-10-12 tsdown for the bundle, `tsc --noEmit` (TypeScript 7) for types: one small ESM file in `dist`, fast checks.
- 2026-10-12 Vitest for tests, Biome for lint and format: one fast tool each.
- 2026-10-12 `.gitattributes eol=lf`: byte-identical fixtures, so token counts match on every OS.
