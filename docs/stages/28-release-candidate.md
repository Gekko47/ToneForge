# Stage 28 — Release candidate

**Canonical status:** see the Stage 28 row in [`ROADMAP.md`](../../ROADMAP.md).

## Objective

Prepare and publish a release only after the hard gates and release evidence
are complete.

## Current release-preparation evidence

- Version `0.2.0` is synchronized in [`package.json`](../../package.json),
  [`package-lock.json`](../../package-lock.json), [`manifest.json`](../../manifest.json),
  and [`manifest.xml`](../../manifest.xml).
- [`docs/CHANGELOG.md`](../CHANGELOG.md) records the refactor candidate.
- The named `toneforge-repository-v1` graph is shared by local verification,
  stage verification, CI, and the release workflow
  [`release.yml`](../../.github/workflows/release.yml). Its recorded repository
  result is summarized in [`ROADMAP.md`](../../ROADMAP.md); this page does not
  claim a fresh run.

## Release blockers

- [x] The 80% exercised-core coverage gate is recorded as passing in the
      canonical verification result.
- [ ] Stage 27 manual host matrix is complete, including live formatting,
      accessibility, provider, and large-document evidence where applicable.
- [ ] Production broker authentication/credential custody and the formal threat
      model are approved.
- [ ] Release acceptance checklist is fully evidenced.
- [x] Refactor candidate review is recorded in the current governance
      documentation.
- [ ] `npm run release:check` passes after the external gates close.
- [ ] Release artifact and GitHub Release are produced by the tagged workflow.

## Current status

The stage is **BLOCKED**. Versioning and build preparation are not evidence that
the release is acceptable. The authoritative gate list and open work are in
[`ROADMAP.md`](../../ROADMAP.md).
