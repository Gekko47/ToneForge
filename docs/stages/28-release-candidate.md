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
- `npm run typecheck`, `npm run lint`, `npm run format`, `npm run test`,
  `npm run build`, and `npm run validate` pass in the audit run.
- The release workflow is [`release.yml`](../../.github/workflows/release.yml).

## Release blockers

- [ ] `npm run test:coverage` passes the global threshold.
- [ ] Stage 27 manual host matrix is complete.
- [ ] Release acceptance checklist is fully evidenced.
- [ ] Any uncommitted refactor candidate is reviewed and either committed with
      an appropriate conventional commit or explicitly excluded from the release.
- [ ] `npm run release:check` passes.
- [ ] Release artifact and GitHub Release are produced by the tagged workflow.

## Current status

The stage is **BLOCKED**. Versioning and build preparation are not evidence that
the release is acceptable. The authoritative gate list and open work are in
[`ROADMAP.md`](../../ROADMAP.md).
