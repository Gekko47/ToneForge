# ToneForge — Production Repository Plan (Historical Scaffold Plan)

> This is a historical scaffold plan. The authoritative implementation plan,
> status, sequencing, refactor mapping, and release gates are in
> [`ROADMAP.md`](../ROADMAP.md). Do not use this file to make current status
> decisions.

## Historical decisions

- TypeScript + React + Fluent UI v8 + Webpack + npm.
- Unified JSON manifest v1.30 with XML fallback.
- Provider-agnostic LLM interface with OpenAI and mock adapters.
- Vitest + jsdom + Testing Library.
- Deterministic-first analysis, optional AI, unified findings, `ChangePlan`, and
  a single Word mutation adapter.

The current tree follows these decisions. The original scaffold also contained
planned-but-not-current paths such as a `src/ui/` root and an older manifest
validation command; those details are retained only as history and are not
current instructions.

## Current source of truth

Read [`ROADMAP.md`](../ROADMAP.md) first, then use:

- [`docs/architecture.md`](../docs/architecture.md) for current boundaries and
  data flow.
- [`docs/onboarding.md`](../docs/onboarding.md) for setup and troubleshooting.
- [`docs/manual-verification.md`](../docs/manual-verification.md) for host
  evidence.
- [`docs/project-state.md`](../docs/project-state.md) for the evidence index.
