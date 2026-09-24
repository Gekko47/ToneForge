# Stage 21 follow-up — stderr warning remediation plan

> Historical execution record. The authoritative current status and sequencing are
> in [`ROADMAP.md`](../ROADMAP.md). This file records the original plan only.

## Baseline

Completed commit `5ded774` (`feat(reformat): add hybrid document reformatter`) is
untouched. All changes below land as a new follow-up fix on top. Safety
invariants are preserved: stale plans are never applied, the Stage 01 gate
blocks mutation, provider failures degrade (never corrupt), hash mismatches
refuse mutation.

## Root causes

### W1 — `ChangePlan validation failed … ChangePlan is stale` (reformat stale test)

Path: [`orchestrator.ts`](src/reformat/orchestrator.ts:110) `planChanges()` sets
`plan.stale = true` for the caller-observed hash mismatch, then line 130 calls
`applyChangePlanWithTracking()` anyway. The adapter correctly refuses via
[`revisionAdapter.ts`](src/word/revisionAdapter.ts:517)
`validatePlanBeforeApply()` → [`revisionAdapter.ts`](src/word/revisionAdapter.ts:81)
`logger.warn`, returning per-change `stale` errors.

Classification: avoidable control-flow failure in the orchestrator. The adapter
guard is correct defense-in-depth, but the orchestrator already knows the plan
is stale and must never enter the mutation adapter with a doomed plan.

Fix: after planning, if `plan.stale` is true, return the preview-shaped outcome
(`results: []`, `tracking: { managed: false }`, `applied: false`,
`stale: plan.stale`) without calling the adapter. Adapter guard stays as-is.

### W2 — `Stage 01 gate not passed; refusing to apply ChangePlan` (reformat gate test)

Path: [`orchestrator.ts`](src/reformat/orchestrator.ts:130) enters the adapter
with the gate closed; [`revisionAdapter.ts`](src/word/revisionAdapter.ts:92)
refuses and warns.

Classification: avoidable — the orchestrator delegates gate enforcement entirely
to the adapter instead of producing its own explicit rejected capability
outcome before adapter entry.

Fix: the orchestrator checks the gate itself (import `STAGE_01_PASSED` from
`word/revisionAdapter`, an allowed `word/*` import) after the pure planning
step. When closed, synthesize per-change refusals with the existing explicit
text (`Stage 01 Office.js capability probe has not passed; mutation blocked`),
`tracking: { managed: false }`, `applied: false`, without entering the adapter.
Snapshot/analyze/plan are read-only/pure, so the mutation gate is enforced at
exactly the boundary that matters. Update the line-67 doc comment (gate is now
enforced by the orchestrator pre-entry; the adapter check remains
defense-in-depth).

### W3/W4 — `Semantic consistency check failed; continuing …` (checker throw + invalid JSON)

Path: [`consistencyChecker.ts`](src/analysis/consistencyChecker.ts:145)
`detectSemanticDeviations()` rejects (`network down` after `withRetry`, or
`Semantic deviation response is not valid JSON` from
[`deviationEngine.ts`](src/analysis/deviationEngine.ts:94)) → caught at
[`consistencyChecker.ts`](src/analysis/consistencyChecker.ts:146) → warn + log
→ `semantic = []`. The returned report is indistinguishable from a clean run
with zero semantic findings: the provider error is masked and missing semantic
findings look like successful validation.

Classification: expected defensive guard (isolation is correct) **plus a real
behavior gap** — degradation is invisible to callers.

Fix: surface degradation in the report with additive schema fields —
`semanticStatus: z.enum(["ok", "skipped", "degraded"]).default("ok")` and
`semanticError: z.string().optional()` (set only when degraded, per
`exactOptionalPropertyTypes`). `buildReport()` takes an optional semantic
parameter; the catch path records `degraded` + the provider message; the
`includeRawText: false` and empty-text paths record `skipped`. The warn log
stays as intentional operational observability. `ReformatResult.report` flows
through unchanged.

### W5 — `Document hash mismatch; refusing to apply ChangePlan` (smokeApply stale test)

Path: deprecated `applySmokePlan()` delegates to the adapter, which passes
validation and gate, then refuses on hash mismatch at
[`revisionAdapter.ts`](src/word/revisionAdapter.ts:106) with a precise
per-change `Document hash mismatch: expected …, got …` error.

Classification: expected defensive guard firing exactly as designed. Behavior
already satisfies the invariant (no mutation, precise hash-mismatch result).
Pre-checking inside the deprecated harness would only duplicate adapter
validation to hide a log — prohibited. No code change; document the warning as
intentional guard evidence.

## Test changes (prove behavior, never hide logs)

- `tests/integration/reformatOrchestrator.test.ts` stale test: expect
  `applySpy` not called, `results` `[]`, `tracking` `{ managed: false }`,
  `plan.stale` true, `applied` false.
- Gate test: expect `applySpy` not called, every result unapplied with
  `capability probe` error, `applied` false.
- `tests/unit/analysis/consistencyChecker.test.ts`: provider-throw and
  invalid-JSON tests assert `semanticStatus === "degraded"` and `semanticError`
  preserves the provider message; add `skipped` assertion for opt-out and `ok`
  for success. Schema-validation test still passes via defaults.
- `smokeApply.test.ts`: unchanged (refusal + precise error already asserted).

## Verification (Code mode)

Reproduce first with the three targeted files, then after the fix re-run them
plus `npm run verify` (typecheck → lint → format → test → build → validate)
and `npm run stage:verify`. Inspect `git status` / `git diff`, commit as one
follow-up `fix:` commit, and append ADR-0029 (orchestrator-owned refusal;
explicit semantic degradation) to `docs/decision-log.md`.

## Expected remaining warnings

- W3/W4 warn logs: intentional — they are the operational record of degraded
  semantic analysis, now paired with an explicit `degraded` report status.
- W5 warn log: intentional — defense-in-depth refusal evidence from the sole
  mutation path.
- W1/W2 warnings: eliminated by corrected control flow, not by silencing.
