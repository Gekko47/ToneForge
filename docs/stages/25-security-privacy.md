# Stage 25 — Security/privacy

**Canonical status:** see the Stage 25 row in [`ROADMAP.md`](../../ROADMAP.md).

## Objective

Harden AI and document-data handling without weakening deterministic governance.

## Implemented in the current worktree

- Separate spot-review and full-document consent settings.
- Context minimization and protected-node exclusion.
- Zod validation of structured review responses.
- Range, protection, dependency, and preservation validation in the safe-apply
  path.
- Coverage-gated CSV/audit export.
- Expanded privacy/security documentation.

## Verification

- [x] Prompt, response-validation, review, safe-apply, and persistence tests pass
      with `MockAdapter` where AI is involved.
- [x] `npm run lint`, typecheck, format, test, build, and manifest validation pass.
- [ ] Formal security review and release sign-off.
- [ ] Decide and document the treatment of the known key-storage limitation.
- [ ] Complete host-specific consent and data-flow verification.

## Current limitation

The current privacy posture is implemented and tested, but the localStorage
fallback is not encrypted by this repository. That limitation and the remaining
formal review are tracked in the canonical roadmap.
