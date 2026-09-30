# Stage 03 — Cline governance

**Gate**: Yes

## Objective

Add Cline rules and skills to support development from initial scaffold through final delivery.

## Scope

- Create `.cline/rules/` with an always-on governance file plus path-scoped rules: mandatory reading, stage protocol, hard rules, commit conventions, and the pre-commit checklist.
- Create `.cline/skills/<skill-name>/SKILL.md` skills (Agent Skills spec: directory + `SKILL.md` with `name` + `description` frontmatter): `toneforge-scaffold`, `toneforge-architecture`, `toneforge-officejs`, `toneforge-llm`, `toneforge-testing`, `toneforge-consistency`.
- Keep `.roo/skills/` and `.roo/rules/` as the Roo Code equivalents, in sync with the `.cline` set.
- Ensure skills are referenced in the stage protocol and onboarding.
- Validate both skill roots in `npm run skills:validate`.

## Verification

- [x] `.cline/rules/toneforge.md` created
- [x] `.cline/rules/` path-scoped rules created
- [x] `.cline/skills/*/SKILL.md` skills created with valid frontmatter
- [x] `.roo/skills/` and `.roo/rules/` refreshed to match the current implementation
- [x] `npm run skills:validate` passes for both skill roots
- [x] Skills referenced in `docs/onboarding.md`
- [x] `npm run verify` passes

## Status

PASS
