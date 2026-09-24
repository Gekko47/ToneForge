# Phases A–G Detailed Plan (Historical Execution Record)

> The canonical current plan is [`ROADMAP.md`](../ROADMAP.md). This file retains
> the detailed refactor execution criteria for audit traceability. It is not a
> second status ledger.

## Scope

- Phase A: structured snapshot, governance profile, coverage, protection,
  registry, additive domain fields, and state v3.
- Phase B: incremental observer and governance status.
- Phase C: Word-native UX, ribbon, task-pane states, navigation, and commands.
- Phase D: consent-gated spot review.
- Phase E: bounded full-document editorial review.
- Phase F: safety, performance, privacy, and regression hardening.
- Phase G: host matrix, release evidence, and reserved consistency seam.
- Phase H: future Content Consistency Review, not started.

## Audit-qualified execution result

The refactor candidate contains code and tests for the main A–F candidate and a
README-only consistency seam. The canonical roadmap records the exact status:

- Phase A: partial; structured node extraction and stronger coverage/protection
  evidence remain open.
- Phase B: partial; observer exists, but live change-range mapping is not proven.
- Phase C: implemented in the worktree; real Word UX/menu/accessibility evidence
  is open.
- Phase D: implemented in the worktree; live provider and host evidence is open.
- Phase E: implemented in the worktree; token/freshness and host evidence are
  open.
- Phase F: partial; safety checks exist, but post-apply verification, performance
  baselines, formal security review, and global coverage are open.
- Phase G: blocked by the host matrix, release checklist, and incomplete seam
  tooling.
- Phase H: reserved and not started.

## Required gate discipline

For any remaining work, use the canonical order in [`ROADMAP.md`](../ROADMAP.md),
run the ordered verification chain, and never convert “code exists” into PASS
without the applicable automated and human evidence.
