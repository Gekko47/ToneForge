# Cross-Report Content Consistency Review (Phase 5)

This directory holds ToneForge's **single sanctioned exception** to the
deterministic-first rule. Comparing two statements in different parts of a
document and deciding whether they contradict each other is interpretation; no
rule answers it, and a rule that approximated one would be confidently wrong on
exactly the cases that matter. See ADR-0052.

It is a **separate engine**. It has its own pipeline, its own third consent flag,
its own opt-in entry point, and its own coverage report. It is not part of the
spot review, the full-document style review, or the typing observer.

## What is here

| Path           | What it is                                                                   |
| -------------- | ---------------------------------------------------------------------------- |
| `contracts.ts` | Zod schemas, the ten check identities, and the consent gate                  |
| `checks/`      | Ten independent checkers plus the shared pure primitives                     |
| `engine.ts`    | Segment → compare → adjudicate → consolidate, with progress and cancellation |
| `bridge.ts`    | The only crossing point into the unified `Finding` model                     |
| `index.ts`     | Public surface; import from here, not from internals                         |

## The ten checks

C1 terminology drift · C2 numeric contradiction · C3 temporal conflict ·
C4 entity attribute conflict · C5 definitional conflict · C6 unit inconsistency ·
C7 status contradiction · C8 reference conflict · C9 section promise mismatch ·
C10 scope contradiction.

C2 and C6 both look at numbers but disagree for different reasons — a changed
value versus the same value in a different unit — and a document can pass one
while failing the other. Each check is a separate question, not a stage of a
build.

## Four properties this engine holds to

1. **It cannot run without its own consent.** `ConsistencyReviewRequest` carries
   `consistencyConsent: z.literal(true)`, persisted separately as
   `settings.consistencyReviewConsent`. Spot-review consent, full-document
   consent, and semantic opt-in do not imply it, and `migrateV8ToV9` sets it to
   `false` rather than deriving it from anything.
2. **A candidate is not a finding.** A `ConsistencyCandidate` is a structured
   comparison that _might_ be a contradiction. Only a deterministic resolution
   or a `contradiction` verdict promotes it.
3. **It is never called from the typing path.** Nothing in `word/`, nothing in
   the observer, no incremental path. A cross-report check over a moving
   document returns different answers as the text shifts underneath it. A run
   whose `revision` no longer matches is discarded rather than reported.
4. **It reports its own coverage.** Comparison is quadratic, so it is bounded at
   `CONSISTENCY_DEFAULT_MAX_STATEMENTS`, and the bound appears in the report as a
   limitation rather than being applied quietly. A truncated review that reads as
   a complete one is the failure mode that matters.

## Known limits, stated rather than hidden

- Six of the ten checks (C4, C5, C7, C8, C10, and the ambiguous residue of C1)
  filter on shared vocabulary and a shared entity anchor. A real conflict whose
  subject overlap falls below that threshold is missed. The alternative —
  escalating every pair — was rejected because a model asked to compare
  everything finds something in everything.
- With no provider configured, the engine still runs every deterministic
  comparison and reports the candidates it could not adjudicate. It degrades
  rather than refusing, and says so in `coverage.limitations`.
- An unreadable or malformed model answer is `unclear` at confidence 0, which is
  the same as no finding. A parse failure must never become a contradiction.
- The engine has not been executed against a real document in a real Word host.
  It is verified by unit tests and `MockAdapter` only.

## Module boundary

`eslint.config.mjs` scopes this directory: `ai/providers` is **allowed** (the
sanctioned exception) while `word/*`, `taskpane/*`, `commands/*`, `reformat/*`,
and `changes/*` remain forbidden. The engine must never reach into the Word
object model or call the revision adapter.
