# Stage 14 — House style rules

**Gate**: Yes

## Objective

Add a deterministic house-style engine that scans document text against
preferred terminology, banned terms, capitalization preferences, and a
bounded spelling-variant dictionary. The engine is pure and returns the same
`Finding` contract established in Stage 13.

## Scope

- `src/rules/houseStyle.ts` — pure deterministic engine.
- Checks:
  - Preferred terminology mapping (case-insensitive, bounded, longest match
    wins on overlap).
  - Banned-term detection with Unicode-aware word boundaries and error
    severity.
  - Sentence-case checking (first cased character of each sentence must be
    uppercase when `capitalization.sentenceCase` is enabled).
  - Title-case word checking (configured words must start with an uppercase
    cased character).
  - Spelling variants for `en-US`, `en-GB`, and `au` from a small data table
    (see `SPELLING_VARIANT_TABLE`).
- Reuses `src/core/domain/Finding` (`kind: "deterministic"`, `confidence: 1`,
  character offsets with inclusive `start` and exclusive `end`).
- Reuses `src/shared/utils/text.ts` (`splitSentences`).
- Tests under `tests/unit/rules/houseStyle.test.ts` (25 cases covering empty
  input, case folding, Unicode offsets, overlap, boundaries, and large
  inputs).

## Configuration

All behaviour is driven by the frozen `HouseStyle` schema (Stage 12). No
schema changes were made.

| Field                           | Type                         | Effect                                                                    |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `preferredTerminology`          | `Record<string, string>`     | Term → preferred replacement. Empty keys/values are ignored.              |
| `bannedTerms`                   | `string[]`                   | Terms flagged with `error` severity. Whitespace-only entries are ignored. |
| `capitalization.sentenceCase`   | `boolean`                    | When `true`, a lowercase first cased character in a sentence is flagged.  |
| `capitalization.titleCaseWords` | `string[]`                   | Words that must start with an uppercase cased character.                  |
| `spellingVariant`               | `"en-US" \| "en-GB" \| "au"` | Selects the preferred spelling column in `SPELLING_VARIANT_TABLE`.        |

## Examples

### Preferred terminology

Input:

```
Use CUSTOMER_ID and customer_id consistently.
```

Findings (2):

```
houseStyle.terminology  range 4–15   evidence "CUSTOMER_ID"
houseStyle.terminology  range 20–31  evidence "customer_id"
```

### Banned terms

Input:

```
color, COLOR and colorful.
```

`bannedTerms: ["color", "  color  ", "COLOR"]`

Findings (2, deduplicated by range):

```
houseStyle.bannedTerm  range 0–5   evidence "color"
houseStyle.bannedTerm  range 7–12  evidence "COLOR"
```

### Sentence case

Input:

```
hello world. another world! third starts here.
```

Findings (3): `h`, `a`, and `t` flagged with severity `warning`.

### Title-case words

Input:

```
the Value and test
```

`titleCaseWords: ["the", "value", "and"]`

Findings (2): `t` and `a` flagged. `Value` is already capitalized and is not
flagged. `test` is not configured.

### Spelling variants

`en-GB` preferred:

```
color favorite program
```

Findings (3): `color`, `favorite`, and `program` flagged with severity
`warning` and a message that includes `en-GB`.

## Limitation

This engine is not a full spellchecker. It only compares words against the
small, reviewable `SPELLING_VARIANT_TABLE`. Unknown words are not flagged.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run test` passes (267 tests, including 25 house-style tests)
- [x] Coverage threshold met for `rules/` (`houseStyle.ts` at 100% lines,
      85.45% statements, 100% functions, 100% branches)
- [x] `npm run lint` passes with zero warnings
- [x] `npm run format` passes
- [x] `npm run build` succeeds
- [x] `npm run validate` passes
- [x] `docs/project-state.md` updated

## Status

PASS
