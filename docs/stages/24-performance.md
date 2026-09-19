# Stage 24 — Performance

**Gate**: Yes

## Objective

Harden analysis for large documents.

## Scope

- Chunked document processing in `src/formatting/analyzer.ts`.
- Worker-ready pure functions (no Office calls inside workers).
- Performance budget tests for documents up to 100k words.
- `src/shared/utils/debounce.ts` for UI responsiveness.

## Verification

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] Performance budget test passes
- [ ] `docs/project-state.md` updated

## Status

PENDING
