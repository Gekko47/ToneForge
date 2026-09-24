# ToneForge

ToneForge is a Microsoft Word Web Add-in for learning an editable style profile,
running deterministic consistency and formatting checks, optionally performing
consent-gated AI editorial review, and applying reviewed changes through a single
Word mutation path.

## Current status

The canonical roadmap, implementation status, refactor mapping, sequencing, and
release gates are in [`ROADMAP.md`](ROADMAP.md). Read that file before making
planning or release decisions.

The current worktree contains an unreleased refactor candidate. Automated
verification passes typecheck, lint, format, tests, build, and manifest
validation; global coverage and the complete Word host matrix remain open. See
[`docs/project-state.md`](docs/project-state.md) for the evidence index and
[`docs/manual-verification.md`](docs/manual-verification.md) for host results.

## Development

```bash
npm install
npm run validate
npm run build
npm run dev
```

In a second terminal, sideload the XML fallback manifest:

```bash
npm run sideload
```

Open Word, load the ToneForge task pane, and use the capability probe and
existing verification panels. See [`docs/onboarding.md`](docs/onboarding.md) for
the full setup and troubleshooting guide.

## Verification

```bash
npm run verify
```

The ordered verification chain is typecheck → lint → format → test → build →
manifest validation. `npm run stage:verify` runs the same ordered checks for a
stage gate. `npm run test:coverage` is a separate release gate and currently
fails the repository-wide 80% threshold; do not claim release readiness while
that gate is open.

## Architecture and privacy

- [`docs/architecture.md`](docs/architecture.md) documents module boundaries and
  the current data flow.
- [`docs/privacy-security.md`](docs/privacy-security.md) documents consent,
  minimization, redaction, and storage limitations.
- [`docs/decision-log.md`](docs/decision-log.md) records architectural decisions.
- `src/analysis/consistency/README.md` reserves the future Content Consistency
  Review seam; no Phase H engine is implemented.
