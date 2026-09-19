# ToneForge Cline Rules

These rules govern how Cline (and other AI coding assistants) interact with the ToneForge repository.

## Mandatory reading before any change

1. Read `ROADMAP.md` — it defines the stage ordering, gates, and hard rules.
2. Read the relevant stage file in `docs/stages/`.
3. Read `docs/architecture.md` for module boundaries.
4. Read `docs/decision-log.md` to avoid repeating rejected decisions.

## Stage protocol

For every stage:

1. Read its stage file.
2. Load only the relevant skills.
3. Inspect before modifying.
4. Implement only the stage scope.
5. Run targeted tests.
6. Run stage verification commands (`npm run stage:verify`).
7. Update `docs/project-state.md`.
8. Record architectural decisions in `docs/decision-log.md`.
9. State status as PASS / PASS WITH DOCUMENTED LIMITATION / BLOCKED / FAIL.
10. Commit the stage only after its gate passes.

## Hard rules

- **Do not build the full reformatter before proving native Word revision behavior.**
- **Deterministic first.** Use code for things that can be measured or safely normalized.
- **AI only where interpretation is necessary.** Use the LLM for tone, voice, rhetorical style, semantic flow, nuanced vocabulary/register, and meaning-preserving rewrites.
- **One canonical profile.** The same `StyleProfile` drives both Reformat and Consistency Check.
- **One mutation path.** Rules and UI never mutate Word directly. Everything flows through `ChangePlan` → revision adapter.
- **Never commit secrets.** API keys go in `.env` (gitignored) or `Office.roamingSettings`.

## Commit conventions

Use conventional commits with roadmap-aligned scopes:

```
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
- [ ] `npm run test` passes
- [ ] `npm run build` succeeds
- [ ] `npm run validate` succeeds
- [ ] `docs/project-state.md` updated
- [ ] `docs/decision-log.md` updated if architectural decision was made
