# ToneForge Refactor — Revised Implementation Plan (Historical Design Record)

> The authoritative current plan and status are in [`ROADMAP.md`](../ROADMAP.md).
> This file records the refactor proposal and its additive strategy. Its stage
> numbering is not the repository's current status numbering.

## Refactor goals

- Add structured document identity, coverage, protection, and policy envelopes
  without replacing existing PASS work.
- Keep deterministic governance separate from optional AI review.
- Preserve one `ChangePlan` → revision-adapter mutation path.
- Reserve Content Consistency Review as a later, whole-document-only expansion.
- Add Word-native UX and bounded review flows only with explicit consent and
  preview.

## Adopted strategy

ADR-0031 adopts additive evolution: existing `StyleProfile`, `Finding`, `Change`,
`ChangePlan`, text snapshots, and the adapter remain compatible; new contracts
and services are layered around them. The worktree contains the Phase A–F
candidate described by the canonical roadmap, but not all acceptance gates are
closed.

## Original proposal sequence

The incoming proposal used stages 00–30 and an offline Stage 21 reintegration
model. The current repository instead preserves the original 00–28 stage map and
maps the proposal to Phases A–G plus reserved Phase H in
[`ROADMAP.md`](../ROADMAP.md).

## Current evidence and limitations

- Production acquisition now uses Word paragraph items and style metadata with
  explicit partial/unsupported coverage. Tables, headers, footers, sections,
  fields, controls, and shapes remain outside the current structural scope.
- The observer has coordinator functions but no verified live change-range event.
- Spot and full-document AI review are implemented in the worktree with mock
  tests, consent, bounded batches, and Zod validation; live host/provider gates
  remain open.
- Safe-apply protection, dependency, preservation, precondition, approval, and
  post-apply verification checks are repository-tested. Live Word behavior,
  accessibility, provider, performance, and release evidence remain open.
- The consistency directory is a documentation-only seam; no C1–C10 engine is
  implemented or imported.

## Historical supporting proposal

The original design artifacts are retained in
[`ToneForge_Refactor_Implementation/ROADMAP.md`](../ToneForge_Refactor_Implementation/ROADMAP.md)
and its [`docs/`](../ToneForge_Refactor_Implementation/docs/INDEX.md) directory.
They are design references, not current status or sequencing authorities.
