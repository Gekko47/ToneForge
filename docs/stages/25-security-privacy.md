# Stage 25 — Security/privacy

**Canonical status:** see the Stage 25 row in [`ROADMAP.md`](../../ROADMAP.md).

## Objective

Harden AI and document-data handling without weakening deterministic governance.

## Implemented in the refactor candidate

- Separate spot-review and full-document consent settings.
- Context minimization and protected-node exclusion.
- Zod validation of structured review responses.
- Range, protection, dependency, and preservation validation in the safe-apply
  path.
- Coverage-gated CSV/audit export.
- Expanded privacy/security documentation.

## Verification

- [x] Prompt, response-validation, review, safe-apply, persistence, redaction,
      sentinel-build, and provider-mode tests pass with `MockAdapter` where AI
      is involved.
- [x] Browser bundles contain only a non-secret allowlist; ordinary state is v5
      and legacy API-key fields are removed and purged.
- [ ] Formal security review and release sign-off.
- [ ] Approve production broker authentication/authorization and credential
      custody.
- [ ] Complete live browser and host-specific consent/data-flow verification.

## Current limitation

The local same-origin/session-nonce broker is development-only and does not
establish a production identity or authorization model. Browser-held production
API keys are not a supported release decision. Formal threat modeling, live
browser credential-flow evidence, and host-specific data-flow verification
remain release gates in [`ROADMAP.md`](../../ROADMAP.md) and
[`docs/privacy-security.md`](../privacy-security.md). Local storage is not
claimed to be encrypted by this repository.
