# Stage 28 — Release candidate

**Gate**: **Hard**

## Objective

Prepare the ToneForge release candidate.

## Scope

- Bump version in `package.json` and `manifest.json`.
- Update `docs/CHANGELOG.md`.
- Run `scripts/release-check.mjs`.
- Tag `v*` and publish via `.github/workflows/release.yml`.

## Verification

- [ ] `node scripts/release-check.mjs` passes
- [ ] `npm run build` succeeds
- [ ] Release artifact zipped
- [ ] GitHub Release published
- [ ] `docs/project-state.md` updated

## Status

PENDING
