# ToneForge Cline Rules

These rules govern how Cline (and other AI coding assistants) interact with the ToneForge repository. They are always active. The path-scoped rules in this directory add detail when you touch the relevant files, and the skills in `.cline/skills/` load on demand.

## Read before changing anything

1. [`ROADMAP.md`](../../ROADMAP.md) — the canonical stage ordering, status ledger, hard rules, and release gates. When another document disagrees with it, it wins.
2. The relevant stage file in [`docs/stages/`](../../docs/stages/).
3. [`docs/architecture.md`](../../docs/architecture.md) — module boundaries, before adding any import.
4. [`docs/decision-log.md`](../../docs/decision-log.md) — so you do not repeat a rejected decision.

## Stage protocol

1. Read the stage file and the canonical roadmap.
2. Load only the skills the work actually needs.
3. Inspect the current implementation before modifying it.
4. Implement only the agreed stage scope.
5. Run targeted tests.
6. Run `npm run verify`.
7. Update [`docs/project-state.md`](../../docs/project-state.md) evidence and the ROADMAP status.
8. Record architectural decisions in [`docs/decision-log.md`](../../docs/decision-log.md).
9. State the result as PASS / PASS WITH DOCUMENTED LIMITATION / IMPLEMENTED / PARTIAL / BLOCKED / FAIL, and name what remains open.
10. Commit only after the gate passes.

## Hard rules

- **Deterministic first.** Anything measurable or safely enumerable is code.
- **AI only where interpretation is necessary.** A model is for tone, voice, rhetorical style, semantic flow, register, and meaning-preserving rewrites. AI is optional and never required for deterministic governance.
- **One canonical profile.** The same `StyleProfile` drives both Reformat and Consistency Review; `GovernanceProfile` is an additive envelope, not a replacement.
- **One mutation path.** Rules and UI never mutate Word. Everything flows through `ChangePlan` → revision adapter → `applyReviewedPlan`.
- **No credential is ever persisted by the add-in.** Not in `Office.roamingSettings`, not in `localStorage`, not in the bundle. Keys live in the gitignored `.env` read by the Node-side development broker, or in the local gateway's memory. `ProviderConnection` has no secret-capable field.
- **Never commit secrets.**
- **Never claim verification you did not perform.** The Word-host gate is human and currently open. A mocked result is a typed contract, not an integration.

## Known open gates

- `npm run host:matrix` reports hosts with **0 fully passing**. Real Word verification is manual and recorded in [`docs/manual-verification.md`](../../docs/manual-verification.md).
- Production credential custody is unresolved. The local dev broker is a development stand-in, not a release component.
- The consistency engine (C1–C10) has never run against a real document or a real model; its checks are uncalibrated heuristics.

A green automated run is never a release claim (ADR-0051).

## Skills

- [`toneforge-scaffold`](../skills/toneforge-scaffold/SKILL.md) — where a file belongs, and the verification chain
- [`toneforge-architecture`](../skills/toneforge-architecture/SKILL.md) — module boundaries and the deterministic-first exception
- [`toneforge-officejs`](../skills/toneforge-officejs/SKILL.md) — reading Word, the single mutation path, tracked-editing gates
- [`toneforge-llm`](../skills/toneforge-llm/SKILL.md) — providers, the gateway, credentials, consents
- [`toneforge-testing`](../skills/toneforge-testing/SKILL.md) — Vitest, mocks, coverage
- [`toneforge-consistency`](../skills/toneforge-consistency/SKILL.md) — the cross-report engine (C1–C10)

Roo Code equivalents live in [`.roo/`](../../.roo/) and are kept in sync with these.

## Commit conventions

```text
feat(word): add native revision adapter
feat(style): add deterministic style metrics
feat(ai): add resilient provider adapters
spike: verify Word revision and document capabilities
chore: scaffold ToneForge Office add-in
test: complete regression and review pass
```

## Before committing

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes with zero warnings
- [ ] `npm run format` passes
- [ ] `npm run secrets:scan` passes
- [ ] `npm run docs:validate` passes
- [ ] `npm run skills:validate` passes
- [ ] `npm run test` passes
- [ ] `npm run test:coverage` meets the 80% thresholds
- [ ] `npm run build` succeeds
- [ ] `npm run validate` succeeds
- [ ] `docs/project-state.md` evidence updated
- [ ] `docs/decision-log.md` updated if an architectural decision was made

`npm run verify` runs all of these in order.
