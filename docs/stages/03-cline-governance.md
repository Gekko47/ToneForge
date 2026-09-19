# Stage 03 — Cline governance

**Gate**: Yes

## Objective

Add Cline rules and skills to support development from initial scaffold through final delivery.

## Scope

- Create `.cline/rules/toneforge.md` with mandatory reading, stage protocol, hard rules, commit conventions, and pre-commit checklist.
- Create `.roo/skills/<skill-name>/SKILL.md` skills (Agent Skills spec: directory + `SKILL.md` with `name` + `description` frontmatter): `toneforge-scaffold`, `toneforge-officejs`, `toneforge-llm`, `toneforge-testing`.
- Ensure skills are referenced in the stage protocol.

## Verification

- [x] `.cline/rules/toneforge.md` created
- [x] `.roo/skills/*/SKILL.md` skills created with valid frontmatter (see `npm run skills:validate`)
- [x] Skills referenced in `docs/onboarding.md`
- [x] `npm run verify` passes

## Status

PASS
