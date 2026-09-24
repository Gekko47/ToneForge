# ToneForge

ToneForge is a Microsoft Word Web Add-in for learning an editable style profile,
running deterministic consistency and formatting checks, optionally performing
consent-gated AI editorial review, and applying reviewed changes through a single
Word mutation path.

## Current status

The canonical roadmap, implementation status, refactor mapping, sequencing, and
release gates are in [`ROADMAP.md`](ROADMAP.md). Read that file before making
planning or release decisions.

The repository contains an unreleased refactor candidate. Automated repository
verification—including 80% exercised-core coverage, secret/docs scans, build,
manifest, and staging checks—passes. The complete Word host matrix and release
acceptance remain open. See [`docs/project-state.md`](docs/project-state.md) for
the evidence index and [`docs/manual-verification.md`](docs/manual-verification.md)
for host results.

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

The ordered repository chain is typecheck → lint → format → secret scan →
documentation links → test → build → manifest validation. Coverage is a
separate 80% release gate and passes. `npm run stage:verify` additionally builds
deterministic release staging and checks the human-evidence release gate; it
remains blocked until the Word host matrix is complete.

## Architecture and privacy

- [`docs/architecture.md`](docs/architecture.md) documents module boundaries and
  the current data flow.
- [`docs/privacy-security.md`](docs/privacy-security.md) documents consent,
  minimization, redaction, and storage limitations.
- [`docs/decision-log.md`](docs/decision-log.md) records architectural decisions.
- `src/analysis/consistency/README.md` reserves the future Content Consistency
  Review seam; no Phase H engine is implemented.
