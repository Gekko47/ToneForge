# Comparative Review: Semantic Style Identification vs. Semantic Profile Parameters

**Scope (corrected, v2).** This document compares the two _semantic_ processes in ToneForge — (A) the **semantic style identification process** (the LLM learning pipeline: prompt builders, extraction schema, leakage check) and (B) the **semantic profile parameters** (the persisted `SemanticStyleProfileSchema` and its consumers) — and evaluates whether their parameters match and are mutually consistent. It does **not** compare against the deterministic/text style system. It also includes a **linguistic review** of all 30+ parameters: duplicates, unnecessary fields, and missing dimensions for identifying a body of text. No code changes are proposed here beyond recommendations.

**User decisions incorporated.**

- `notes` is **user-only** — never produced by identification. Not a gap.
- Profile UI should use **comboboxes** (editable, with generic options) so the user can type custom values and pull in the identified style.
- V1 identification path should be **deprecated**.
- Redundancies must be **verified and resolved** (remove one or sync).
- Prompt strings and Zod schemas must be **synced** (automated check or codegen).
- The pane must expose **all 30+ parameters** (currently only ~15 are shown).
- "Sample diagnostics" section should be **removed** from the Semantic Style page.
- "Use this style" section should be **removed** (publish draft is the application point).

**Sources of truth.**

- Identification (A): `src/ai/prompts/profilePrompts.ts` (`buildProfilePrompt`, `buildProfilePromptV2`, `ProfileResponseSchema`, `ENUM_OPTIONS`, `RESPONSE_SKELETON`); `src/analysis/semantic/semanticStyleExtraction.ts` (`SemanticStyleExtractionSchema`, `parseSemanticStyleExtraction`, `extractionFreeText`); `src/style/profiler.ts` (`buildStyleProfile`, V1/V2 switch).
- Profile (B): `src/core/domain/SemanticStyleProfile.ts` (`SemanticStyleProfileSchema`, `SEMANTIC_DIMENSIONS`, `isDefaultSemanticStyle`, `createEmptySemanticStyleProfile`, `LegacySemanticProfileV1Schema`, `StoredSemanticStyleSchema`, `migrateSemanticStyleFromV1`); `src/core/domain/StyleProfile.ts` (`StyleProfileSchema.semantic`).
- Review consumers: `src/analysis/semantic/contracts.ts` (`SemanticAssessmentSchema`, `MeaningPreservationAssessmentSchema`, `SemanticReviewRequestSchema`); `src/analysis/semantic/reviewPrompt.ts` (`SEMANTIC_DIMENSIONS_LIST`, `DIMENSION_ENUMS`); `src/analysis/semantic/reviewSchema.ts` (`SemanticReviewResponseSchema`, `ProposedRevisionSchema`).
- UI: `src/taskpane/components/SemanticProfileEditor.tsx`, `src/taskpane/components/semantic/SelectedTextStyle.tsx`, `src/taskpane/pages/SemanticStyle.tsx`.

---

## 1. Process A — Semantic Style Identification (Learning Pipeline)

**Mechanism.** An LLM reads a writing sample (raw text, opt-in only) and returns a JSON object. Two prompt versions exist:

### 1.1 V1 path (legacy, to be deprecated)

- Prompt: `buildProfilePrompt` in `profilePrompts.ts`.
- Expected shape: `ProfileResponseSchema` — 8 flat fields:
  - `tone` (free string), `voice` (free string), `formality` (0–100), `readingGradeTarget` (0–20, nullable), `preferredSentenceLength` (5–60), `vocabularyRegister` (simple/standard/technical/academic), `rhetoricalStyle` (free string), `avoidWords` (string[]).
- Mapped to V2 via `migrateSemanticStyleFromV1` (same function as the v14 state migration).
- Still reachable via `promptVersion: "v1"` in `profiler.ts` (`buildStyleProfile`).
- **Status: deprecated.** Should be removed once all callers use V2. `migrateSemanticStyleFromV1` must be retained for state migration (v13 stores) until state v15.

### 1.2 V2 path (current default)

- Prompt: `buildProfilePromptV2` in `profilePrompts.ts`.
- Expected shape: `SemanticStyleExtractionSchema` — 16 groups, each required, no defaults (strict).
- Prompt components:
  - `RESPONSE_SKELETON` — literal JSON skeleton showing nesting, delimiters, and type of every value.
  - `ENUM_OPTIONS` — allowed values for every enum field.
  - Leakage instruction: "Describe the writing, not its subject. A description must not name a project, a company, a person, a date, an amount, or any other fact from the sample."
- Validation: `parseSemanticStyleExtraction(raw, sampleText)`:
  1. Schema parse (`SemanticStyleExtractionSchema.safeParse`).
  2. Empty-analysis check (`isDefaultSemanticStyle`).
  3. Factual-leakage check (`findFactsPresentIn(extractionFreeText(extraction), extractProtectedFacts(sampleText))`).
- Transform: extraction → persisted via `SemanticStyleProfileSchema.parse({...createEmptySemanticStyleProfile(), ...stripUndefined(extraction)...})`.

### 1.3 Extraction schema detail

`SemanticStyleExtractionSchema` requires all 16 groups. Each group is the `.partial()` of the corresponding persisted schema group (so leaves can be omitted and filled from defaults, but the group itself must be present):

| Group                   | Leaves (all optional within group)                                                |
| ----------------------- | --------------------------------------------------------------------------------- |
| `tone`                  | primary, secondary (≤2), description                                              |
| `voice`                 | person, construction, authorialPresence, description                              |
| `formality`             | score (0–100), label                                                              |
| `register`              | primary, description                                                              |
| `assertionStyle`        | strength, ordering, directness                                                    |
| `qualificationStyle`    | frequency, strength, exceptions, conditionals                                     |
| `evidenceFraming`       | recordFirst, attribution, quotation, explicitReferences, progression              |
| `uncertaintyStyle`      | incompleteEvidence, confidenceLanguage, modality, avoidsUnsupportedCertainty      |
| `sentenceArchitecture`  | complexity, clauseDensity, targetWords (5–60), coordination, shortClosingSentence |
| `paragraphArchitecture` | function, ordering, targetWords (20–400), propositions                            |
| `transitions`           | (scalar enum)                                                                     |
| `agency`                | actorNaming, passiveTendency, attributionPrecision                                |
| `technicality`          | density, explainsTerms, abbreviationTendency                                      |
| `rhetoricalStyle`       | (scalar enum)                                                                     |
| `conclusionStyle`       | form, avoidsRepetition                                                            |
| `lexicalPreferences`    | toneAvoid (≤100), prefersNeutralVerbs, evaluativeLanguage                         |

### 1.4 Leakage check surface

`extractionFreeText(extraction)` concatenates:

- `extraction.tone.description`
- `extraction.voice.description`
- `extraction.register.description`
- `extraction.lexicalPreferences.toneAvoid` (joined)

**Not included:** `extraction.formality.label` (a free-text field, ≤40 chars). **This is a gap** — see R1.

---

## 2. Process B — Semantic Profile Parameters (Persisted Schema)

**Mechanism.** The persisted shape `SemanticStyleProfileSchema` (16 dimensions + 3 meta fields), stored on a `StyleProfile` record (`kind: "semantic"`). All fields default, so a stored record tolerates absence.

### 2.1 The 16 dimensions (identical to extraction groups)

Same 16 dimensions and sub-fields as listed in §1.3, but with `.default(...)` on every leaf and group. See `SemanticStyleProfile.ts` lines 84–260.

### 2.2 Meta fields

| Field           | Type                          | Source                                                                                                                                                | Notes                  |
| --------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `notes`         | `string[]` (≤20, each ≤240)   | **User-only.** Never produced by identification. Manual editor field.                                                                                 | Not a gap — by design. |
| `legacyV1`      | `LegacySemanticV1` (optional) | Migration only (`migrateSemanticStyleFromV1`). Carries `readingGradeTarget`, `vocabularyRegister`, `tone`, `voice`, `rhetoricalStyle` (free strings). | Migration-only.        |
| `schemaVersion` | literal `2`                   | Defaulted by schema.                                                                                                                                  | Aligned by design.     |

### 2.3 Review-side consumers (consistent with profile)

- `SemanticAssessmentSchema.observations[].dimension` — `ModelDimensionSchema` coerces to `SemanticDimension` (one of 16). `DIMENSION_ALIASES` maps `sentencelength` → `sentenceArchitecture`, `paragraphlength` → `paragraphArchitecture`.
- `reviewPrompt.ts` `SEMANTIC_DIMENSIONS_LIST` — identical to `SEMANTIC_DIMENSIONS` (16 names, same order).
- `reviewPrompt.ts` `DIMENSION_ENUMS` — identical to `profilePrompts.ts` `ENUM_OPTIONS` (verified all 30+ enum values match).
- `SemanticReviewRequestSchema.semantic` — `z.custom<SemanticStyleProfile>()` (the full persisted profile).
- `reviewDomainFor(semantic)` — derives domain from `semantic.register.primary === "expert"`.

---

## 3. Correspondence Map (Identification ↔ Profile)

| Identification (A)                                                                                         | Profile (B)                                                                                                                                                             | Status                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `SemanticStyleExtractionSchema` (16 groups, strict, no defaults)                                           | `SemanticStyleProfileSchema` (16 groups, all defaults)                                                                                                                  | **Aligned** — extraction is `.partial()` of each persisted group; transform merges with defaults.            |
| `buildProfilePromptV2` `RESPONSE_SKELETON` (16 keys)                                                       | `SEMANTIC_DIMENSIONS` (16 names)                                                                                                                                        | **Aligned** — same keys, same order.                                                                         |
| `ENUM_OPTIONS` (all enum values)                                                                           | Schema enums (`ToneTraitSchema`, `VoiceProfileSchema`, etc.)                                                                                                            | **Aligned** — verified all 30+ enum values match exactly.                                                    |
| `ENUM_OPTIONS` boolean list (8 booleans)                                                                   | Schema booleans (recordFirst, explicitReferences, avoidsUnsupportedCertainty, shortClosingSentence, explainsTerms, avoidsRepetition, conditionals, prefersNeutralVerbs) | **Aligned** — 8 of 8.                                                                                        |
| `ENUM_OPTIONS` string-array list (tone.secondary, toneAvoid)                                               | Schema arrays (tone.secondary max 2, toneAvoid max 100)                                                                                                                 | **Aligned**.                                                                                                 |
| `ENUM_OPTIONS` free-text list (tone.description, voice.description, register.description, formality.label) | Schema free-text fields (3 descriptions + formality.label)                                                                                                              | **Aligned** — 4 of 4.                                                                                        |
| `extractionFreeText()` (3 descriptions + toneAvoid)                                                        | Free-text fields (4: 3 descriptions + formality.label)                                                                                                                  | **MISMATCH** — `formality.label` is NOT in the leakage check.                                                |
| `notes` (not in extraction schema, not in prompt)                                                          | `notes` (≤20 strings, ≤240 each)                                                                                                                                        | **Aligned by design** — user-only field, never produced by identification.                                   |
| `legacyV1` (not in extraction)                                                                             | `legacyV1` (optional, migration-only)                                                                                                                                   | **Aligned by design** — identification produces V2 directly.                                                 |
| `schemaVersion` (not in extraction)                                                                        | `schemaVersion: 2` (defaulted)                                                                                                                                          | **Aligned by design** — defaulted by persisted schema.                                                       |
| V1 `ProfileResponseSchema` (8 flat fields)                                                                 | V2 profile (16 dimensions)                                                                                                                                              | **Legacy mismatch** — V1 produces 8 fields, V2 has 16. Migration maps only 6 of 9 V1 fields. **Deprecated.** |
| V1 `readingGradeTarget` (0–20, nullable)                                                                   | No V2 home                                                                                                                                                              | **Documented gap** — carried in `legacyV1`.                                                                  |
| V1 `vocabularyRegister` (4 levels)                                                                         | `register.primary` (6 levels)                                                                                                                                           | **Lossy mapping** — best-effort (simple→plain, standard→professional).                                       |
| `isDefaultSemanticStyle` (checks 16 dims + notes)                                                          | Profile defaults                                                                                                                                                        | **Aligned** — checks all 16 dimensions' defaults + notes.length === 0.                                       |
| `toPersistedSemanticStyle` transform (16 groups)                                                           | Persisted schema (16 groups + 3 meta)                                                                                                                                   | **Aligned** — sets all 16 groups; meta fields get defaults.                                                  |
| Review `SEMANTIC_DIMENSIONS_LIST` (16)                                                                     | `SEMANTIC_DIMENSIONS` (16)                                                                                                                                              | **Aligned** — identical names and order.                                                                     |
| Review `DIMENSION_ENUMS` (30+ values)                                                                      | `ENUM_OPTIONS` (30+ values)                                                                                                                                             | **Aligned** — identical.                                                                                     |
| Review `ModelDimensionSchema` aliases (sentencelength, paragraphlength)                                    | Profile dimension names (sentenceArchitecture, paragraphArchitecture)                                                                                                   | **Aligned** — aliases bridge model shorthand to canonical names.                                             |

---

## 4. Alignment Evaluation

### 4.1 Gaps

1. **`formality.label` is not in the factual-leakage check.** `formality.label` is a free-text field (≤40 chars) that the prompt asks for (`"label": "<short label>"`) and that `ENUM_OPTIONS` lists as a free-text field. But `extractionFreeText()` does not include it. A model could put a project name, date, or figure in the formality label and it would not be caught by `findFactsPresentIn`. This is a real leakage gap. **(R1, high priority)**

### 4.2 Mismatches

1. **Soft contract tension: prompt strict, schema lenient.** The prompt says "every key inside them must be present" (all leaves required), but the extraction schema uses `.partial()` on each group (leaves optional, filled from defaults). This is deliberate — a group the model omits is a refusal, but a leaf it omits inside a group it did answer is filled from the default. However, this means the prompt is stricter than the schema: a model that omits a leaf gets a default rather than a refusal. The design rationale is documented in `semanticStyleExtraction.ts` comments, but the tension is worth noting.

2. **`tone.secondary` wording imprecision.** The prompt's `ENUM_OPTIONS` calls it a "string array field" (`"String array fields: tone.secondary, lexicalPreferences.toneAvoid."`), but `tone.secondary` is an array of enum values (`ToneTrait`), not strings. Minor wording issue that could confuse a model. **(R5, low priority)**

3. **V1 path still reachable.** `profiler.ts` supports `promptVersion: "v1"`, which uses `buildProfilePrompt` + `ProfileResponseSchema` (8 flat fields). The V1 prompt produces free strings for `tone`, `voice`, `rhetoricalStyle` — types that don't match the V2 enums. The migration maps only 6 of 9 V1 fields; `readingGradeTarget` and `vocabularyRegister` have no exact V2 home. **Deprecated — should be removed. (R6)**

### 4.3 Redundancies

1. **`ENUM_OPTIONS` and `DIMENSION_ENUMS` are duplicated.** `profilePrompts.ts` has `ENUM_OPTIONS` (used in `buildProfilePromptV2`) and `reviewPrompt.ts` has `DIMENSION_ENUMS` (used in `buildSemanticReviewPrompt`). They contain identical content (verified). Two copies of the same enum list must be kept in sync manually. **(R7, low priority — consolidate)**

2. **`RESPONSE_SKELETON` and the review prompt's skeleton are separate.** The learning prompt (`buildProfilePromptV2`) has `RESPONSE_SKELETON` (16 keys, full nesting). The review prompt (`buildSemanticReviewPrompt`) has its own skeleton (assessment, proposedRevision, meaningPreservation, rationale). These are different shapes (profile vs. review), so duplication is expected, but the enum values must stay consistent.

### 4.4 Asymmetries

1. **Hand-maintained prompt strings vs. schema.** The prompt's `ENUM_OPTIONS` and `RESPONSE_SKELETON` are hand-written strings that must stay in sync with the Zod schemas. There is no automated check (no codegen, no test that verifies the prompt's enum list matches the schema's enum values). A schema change (e.g., adding a new `ToneTrait`) requires manual updates to both `ENUM_OPTIONS` and `RESPONSE_SKELETON`. This is a drift risk. **(R4, medium priority)**

2. **`notes` is user-only.** The profile has `notes` but the identification process has no way to populate it — and should not. Notes is a user-authored field for observations that don't fit the enums. This is by design, not a gap. **Documented as user-only.**

3. **`formality.label` is free text but not leakage-checked.** As noted in §4.1.1, this is an asymmetry: 3 of 4 free-text fields are leakage-checked, but `formality.label` is not.

---

## 5. Linguistic Review of All 30+ Parameters

A linguist's assessment of every parameter in the semantic profile: which are duplicates, which are unnecessary, and what is missing for identifying what makes up a body of text.

### 5.1 Parameter inventory (49 leaves across 16 dimensions)

| #   | Dimension             | Leaves                                                                                               | Type                        |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | tone                  | primary (8 traits), secondary (≤2), description                                                      | enum + array + free text    |
| 2   | voice                 | person (4), construction (3), authorialPresence (3), description                                     | 3 enums + free text         |
| 3   | formality             | score (0–100), label (≤40)                                                                           | int + free text             |
| 4   | register              | primary (6), description                                                                             | enum + free text            |
| 5   | assertionStyle        | strength (4), ordering (3), directness (3)                                                           | 3 enums                     |
| 6   | qualificationStyle    | frequency (3), strength (3), exceptions (3), conditionals (bool)                                     | 3 enums + bool              |
| 7   | evidenceFraming       | recordFirst (bool), attribution (3), quotation (3), explicitReferences (bool), progression (3)       | 2 bools + 3 enums           |
| 8   | uncertaintyStyle      | incompleteEvidence (3), confidenceLanguage (3), modality (3), avoidsUnsupportedCertainty (bool)      | 3 enums + bool              |
| 9   | sentenceArchitecture  | complexity (3), clauseDensity (3), targetWords (5–60), coordination (3), shortClosingSentence (bool) | 2 enums + int + enum + bool |
| 10  | paragraphArchitecture | function (5), ordering (4), targetWords (20–400), propositions (2)                                   | 2 enums + int + enum        |
| 11  | transitions           | (scalar, 3)                                                                                          | enum                        |
| 12  | agency                | actorNaming (4), passiveTendency (3), attributionPrecision (3)                                       | 3 enums                     |
| 13  | technicality          | density (3), explainsTerms (bool), abbreviationTendency (3)                                          | 2 enums + bool              |
| 14  | rhetoricalStyle       | (scalar, 6)                                                                                          | enum                        |
| 15  | conclusionStyle       | form (5), avoidsRepetition (bool)                                                                    | enum + bool                 |
| 16  | lexicalPreferences    | toneAvoid (≤100), prefersNeutralVerbs (bool), evaluativeLanguage (3)                                 | array + bool + enum         |

### 5.2 Duplicates (fields that describe the same phenomenon)

| #   | Field A                                                     | Field B                                                   | Relationship                                                                                                                                                                              | Recommendation                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `agency.passiveTendency` (low/medium/high)                  | `voice.construction` (active/passive/balanced)            | **True duplicate.** Both describe the active/passive balance of the prose. A profile with `construction: "active"` and `passiveTendency: "high"` is internally contradictory.             | **Remove `passiveTendency`.** Keep `voice.construction` as the single source of truth. It is more precise (3 distinct values vs. a frequency scale). Derive passiveTendency from construction if needed for backward compat. |
| D2  | `sentenceArchitecture.complexity` (simple/moderate/complex) | `sentenceArchitecture.clauseDensity` (low/medium/high)    | **Near-duplicate.** Complexity and clause density are highly correlated — complex sentences have more clauses. Two fields measuring the same underlying dimension.                        | **Merge into one field.** Keep `complexity` as the primary (it is more intuitive for users). Remove `clauseDensity` or derive it from complexity.                                                                            |
| D3  | `uncertaintyStyle.modality` (frequent/occasional/rare)      | `qualificationStyle.frequency` (rare/occasional/frequent) | **Near-duplicate.** Both concern hedging/qualification frequency. A writer who frequently qualifies claims also uses frequent modality.                                                   | **Merge or clarify.** Either merge into one field (`hedgingFrequency`) or document the distinction: modality = modal verb frequency, qualification = claim-qualification frequency.                                          |
| D4  | `formality.score` (0–100)                                   | `register.primary` (6 levels)                             | **Partial duplicate.** Register implies formality: "plain" ≈ low formality, "legal-technical" ≈ high formality. Highly correlated but conceptually distinct (social distance vs. domain). | **Keep both** but add a Zod `.refine()` or document the relationship. The distinction is real (a technical register can be informal; a plain register can be formal).                                                        |
| D5  | `tone.primary` (8 traits)                                   | `rhetoricalStyle` (6 values)                              | **Partial duplicate.** "forensic" tone and "forensic" rhetorical style are near-synonyms. But tone = affective stance, rhetoricalStyle = argumentative strategy.                          | **Keep both** but clarify the distinction in the prompt: tone = how it feels, rhetoricalStyle = how it argues. Add examples to ENUM_OPTIONS.                                                                                 |
| D6  | `technicality.density` (low/medium/high)                    | `register.primary` (6 levels)                             | **Partial duplicate.** "technical" register implies high technicality density.                                                                                                            | **Keep both** — register is about domain, technicality is about term density. A technical register can have low term density (accessible technical writing).                                                                 |

### 5.3 Unnecessary fields (could be removed or folded)

| #   | Field                                                     | Reason                                                                                                                                              | Recommendation                                                                                                                                                                                                     |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1  | `formality.label` (free text ≤40)                         | A free-text label for a numeric score. The score is what rules compare; the label is human-readable but is a leak surface (not leakage-checked).    | **Keep but add to leakage check (R1).** Alternatively, derive label from score ranges (0–25: informal, 26–50: neutral, 51–75: formal, 76–100: highly formal).                                                      |
| U2  | `voice.description` (free text ≤240)                      | Free text, leak surface. The enums (person, construction, authorialPresence) capture the key dimensions.                                            | **Keep** — descriptions capture nuance the enums cannot. But ensure leakage check covers it (it does).                                                                                                             |
| U3  | `tone.description` (free text ≤240)                       | Same as U2.                                                                                                                                         | **Keep** — same reasoning.                                                                                                                                                                                         |
| U4  | `register.description` (free text ≤240)                   | Same as U2.                                                                                                                                         | **Keep** — same reasoning.                                                                                                                                                                                         |
| U5  | `conclusionStyle.avoidsRepetition` (bool)                 | More of a quality check than a style dimension. "Does the author avoid repeating conclusions?" is a binary quality judgment, not a stylistic trait. | **Consider removing** or moving to a quality-check dimension. If kept, rename to `conclusionStyle.repetition` (none/some/frequent) for consistency with other enums.                                               |
| U6  | `lexicalPreferences.prefersNeutralVerbs` (bool)           | Very specific. A boolean for verb neutrality is an odd granularity — most writers are somewhere on a spectrum.                                      | **Consider converting to enum** (`verbPreference: "neutral"                                                                                                                                                        | "evaluative"   | "mixed"`) or folding into `tone`or`lexicalPreferences.evaluativeLanguage`. |
| U7  | `technicality.explainsTerms` (bool)                       | Boolean for "does the author explain terms?" Could be folded into `technicality.density` or `register`.                                             | **Consider converting to enum** (`termExplanation: "always"                                                                                                                                                        | "on-first-use" | "never"`) for consistency.                                                 |
| U8  | `agency.attributionPrecision` (exact/general/unspecified) | Could be folded into `evidenceFraming.attribution` (none/occasional/systematic). Both concern how precisely sources are attributed.                 | **Consider merging** into `evidenceFraming.attribution` with expanded values, or keep separate if the distinction (precision vs. frequency) is meaningful.                                                         |
| U9  | `qualificationStyle.exceptions` (none/inline/dedicated)   | Very specific. "How are exceptions handled?" is a narrow concern.                                                                                   | **Keep** — it is a distinctive feature of expert writing (dedicated exception paragraphs vs. inline caveats). But consider whether it belongs in `qualificationStyle` or a separate `exceptionHandling` dimension. |

### 5.4 Missing dimensions (for identifying a body of text)

From a corpus linguistics / stylistics perspective, the following dimensions are missing and would improve the profile's ability to characterize a body of text:

| #   | Missing dimension              | Linguistic basis                                                                                                                                                                                                                               | Priority | Suggested field                                                                                                                                                                                         |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | **Rhythm / variability**       | Sentence-length standard deviation is measured (`measured.sentenceLengthStdDev`) but has no semantic counterpart. A writer's rhythm (variation in sentence length) is a key stylistic feature (Crystal, _Cambridge Encyclopedia of Language_). | High     | `rhythm: { sentenceVariability: "low" \| "medium" \| "high", paragraphVariability: "low" \| "medium" \| "high" }` (17th dimension) or sub-fields in `sentenceArchitecture` and `paragraphArchitecture`. |
| M2  | **Cohesion**                   | How tightly connected the text is: connective density, anaphora usage, lexical chains. A key dimension in Halliday & Hasan's cohesion theory.                                                                                                  | Medium   | `cohesion: { connectiveDensity: "low" \| "medium" \| "high", anaphora: "frequent" \| "occasional" \| "rare" }`                                                                                          |
| M3  | **Stance**                     | The author's epistemic/affective attitude toward the subject. Partially covered by `tone` but no dedicated stance dimension. Hyland's stance framework (hedges, boosters, attitude markers, self-mention).                                     | Medium   | `stance: { epistemic: "hedged" \| "assertive" \| "mixed", affective: "neutral" \| "evaluative" \| "engaged" }`                                                                                          |
| M4  | **Engagement**                 | How the author engages the reader: direct address, questions, imperatives, reader pronouns. Hyland's engagement framework.                                                                                                                     | Medium   | `engagement: { readerAddress: "direct" \| "indirect" \| "absent", questions: "frequent" \| "occasional" \| "rare" }`                                                                                    |
| M5  | **Nominalization tendency**    | Tendency to use nominalized forms (e.g., "the implementation of" vs. "implementing"). A key feature of academic/technical writing (Halliday).                                                                                                  | Low      | `nominalization: "frequent" \| "occasional" \| "rare"` (sub-field of `technicality` or `sentenceArchitecture`)                                                                                          |
| M6  | **Temporal orientation**       | Past/present/future tense preference. Affects the feel of the prose (narrative past vs. analytical present).                                                                                                                                   | Low      | `temporalOrientation: "past" \| "present" \| "mixed"` (sub-field of `voice` or new dimension)                                                                                                           |
| M7  | **Information structure**      | Given/new information, topic-comment structure. Affects how paragraphs are organized.                                                                                                                                                          | Low      | `informationStructure: "topic-comment" \| "given-new" \| "mixed"` (sub-field of `paragraphArchitecture`)                                                                                                |
| M8  | **Lexical density**            | Ratio of content words to function words. A measure of informational density.                                                                                                                                                                  | Low      | `lexicalDensity: "low" \| "medium" \| "high"` (sub-field of `technicality` or `lexicalPreferences`)                                                                                                     |
| M9  | **Sentence type distribution** | Declarative/interrogative/imperative/exclamatory ratio. Affects the rhetorical feel.                                                                                                                                                           | Low      | `sentenceTypes: { declarative: "dominant" \| "mixed", interrogative: "frequent" \| "rare", imperative: "frequent" \| "rare" }`                                                                          |
| M10 | **Hedging/boosting**           | Beyond frequency (covered by `qualificationStyle` and `uncertaintyStyle.modality`), the _type_ of hedging (epistemic, deontic, politeness).                                                                                                    | Low      | Expand `uncertaintyStyle.modality` to distinguish types, or add `hedgingType: "epistemic" \| "deontic" \| "politeness" \| "mixed"`                                                                      |
| M11 | **Argumentation structure**    | Toulmin model: claim, data, warrant, backing, rebuttal, qualifier. How arguments are constructed.                                                                                                                                              | Low      | `argumentation: { structure: "claim-evidence" \| "evidence-claim" \| "dialectical" \| "narrative" }` (overlaps with `evidenceFraming.progression`)                                                      |
| M12 | **Voice/person consistency**   | Whether the author maintains consistent person throughout. A consistency check, not just a preference.                                                                                                                                         | Low      | `personConsistency: "consistent" \| "mixed" \| "shifting"` (sub-field of `voice`)                                                                                                                       |

### 5.5 Summary of linguistic review (ordered by fix priority)

| Priority | Item                                      | Type                            | Recommendation                                                     | Ref               |
| -------- | ----------------------------------------- | ------------------------------- | ------------------------------------------------------------------ | ----------------- |
| High     | U1 `formality.label`                      | Unnecessary (keep but refine)   | Derive from score ranges or remove; add to leakage check           | R1, R14           |
| High     | M1 `rhythm` / variability                 | Missing                         | Add `rhythm` dimension (sentenceVariability, paragraphVariability) | R9                |
| High     | D1 `passiveTendency` / `construction`     | True duplicate                  | Remove `passiveTendency`; keep `voice.construction`                | R8                |
| Medium   | D2 `complexity` / `clauseDensity`         | Near-duplicate                  | Merge into one field (`complexity`)                                | R8                |
| Medium   | D3 `modality` / `qualification frequency` | Near-duplicate                  | Merge or clarify distinction                                       | R8                |
| Medium   | D4 `formality` / `register`               | Partial duplicate               | Keep both; add Zod `.refine()`                                     | R8                |
| Medium   | D5 `tone` / `rhetoricalStyle`             | Partial duplicate               | Keep both; clarify distinction in prompt                           | R8                |
| Medium   | D6 `technicality` / `register`            | Partial duplicate               | Keep both; document distinction                                    | R8                |
| Medium   | M2 `cohesion`                             | Missing                         | Add `cohesion` dimension                                           | R9                |
| Medium   | M3 `stance`                               | Missing                         | Add `stance` dimension                                             | R9                |
| Medium   | M4 `engagement`                           | Missing                         | Add `engagement` dimension                                         | R9                |
| Medium   | U5 `avoidsRepetition`                     | Unnecessary (consider removing) | Remove or convert to enum                                          | R10               |
| Medium   | U6 `prefersNeutralVerbs`                  | Unnecessary (keep but refine)   | Convert to enum or fold into `evaluativeLanguage`                  | R10               |
| Medium   | U7 `explainsTerms`                        | Unnecessary (keep but refine)   | Convert to enum                                                    | R10               |
| Medium   | U8 `attributionPrecision`                 | Unnecessary (keep but refine)   | Merge into `evidenceFraming.attribution`                           | R10               |
| Medium   | U9 `exceptions`                           | Unnecessary (keep but refine)   | Keep; consider renaming dimension                                  | R10               |
| Low      | M5 `nominalization`                       | Missing                         | Sub-field of `technicality` or `sentenceArchitecture`              | R9 (future phase) |
| Low      | M6 `temporalOrientation`                  | Missing                         | Sub-field of `voice` or new dimension                              | R9 (future phase) |
| Low      | M7 `informationStructure`                 | Missing                         | Sub-field of `paragraphArchitecture`                               | R9 (future phase) |
| Low      | M8 `lexicalDensity`                       | Missing                         | Sub-field of `technicality` or `lexicalPreferences`                | R9 (future phase) |
| Low      | M9 `sentenceTypes`                        | Missing                         | New field or sub-field                                             | R9 (future phase) |
| Low      | M10 `hedgingType`                         | Missing                         | Expand `uncertaintyStyle.modality`                                 | R9 (future phase) |
| Low      | M11 `argumentation`                       | Missing                         | Overlaps with `evidenceFraming.progression`                        | R9 (future phase) |
| Low      | M12 `personConsistency`                   | Missing                         | Sub-field of `voice`                                               | R9 (future phase) |
| Low      | U2–U4 `descriptions`                      | Unnecessary (keep but refine)   | Keep; already leakage-checked                                      | R10               |

---

## 6. Recommendations

### R1. Add `formality.label` to the leakage check (high priority)

**Problem.** `formality.label` is a free-text field (≤40 chars) that is not included in `extractionFreeText()`. A factual leak in the formality label would not be caught.

**Recommendation.** Add `extraction.formality.label ?? ""` to the array in `extractionFreeText()` in `semanticStyleExtraction.ts`.

**Justification.** The leakage check exists to prevent document facts from entering the profile. All free-text fields are leak surfaces. Omitting one defeats the purpose of the check.

### R2. Broaden the prompt's leakage instruction to cover all free-text fields (medium priority)

**Problem.** The leakage instruction says "A description must not name a project..." — but `formality.label` is a label, not a description. The instruction doesn't clearly cover it.

**Recommendation.** Change "A description must not name..." to "No free-text field (description or label) must name a project, a company, a person, a date, an amount, or any other fact from the sample."

**Justification.** Consistency: the instruction should cover all free-text fields, not just descriptions.

### R3. Document `notes` as user-only (low priority)

**Problem.** `notes` exists in the profile but is never produced by identification. This is by design — notes is a user-authored field.

**Recommendation.** Add a comment to `SemanticStyleProfileSchema.notes` stating "User-only; never produced by identification." Remove from `isDefaultSemanticStyle` check (or keep, since empty array is the default). No schema change needed.

**Justification.** Documentation prevents future contributors from assuming notes is LLM-produced.

### R4. Add an automated sync check between prompt strings and schema enums (medium priority)

**Problem.** `ENUM_OPTIONS` and `DIMENSION_ENUMS` are hand-maintained strings that must stay in sync with the Zod schemas. There is no automated check.

**Recommendation.** Add a test (or a codegen step) that verifies:

- Every enum value in `ToneTraitSchema.options` appears in `ENUM_OPTIONS`.
- Every dimension in `SEMANTIC_DIMENSIONS` appears in `RESPONSE_SKELETON`.
- `SEMANTIC_DIMENSIONS_LIST` equals `SEMANTIC_DIMENSIONS`.

**Justification.** This is the same class of drift that `semanticStyleExtraction.ts` was created to prevent. An automated check is cheaper than a codegen step and catches drift at test time.

### R5. Fix `tone.secondary` wording in `ENUM_OPTIONS` (low priority)

**Problem.** The prompt calls `tone.secondary` a "string array field" but it's an array of enum values.

**Recommendation.** Change "String array fields: tone.secondary, lexicalPreferences.toneAvoid." to "Array fields: tone.secondary (enum values, at most 2), lexicalPreferences.toneAvoid (strings)."

**Justification.** Precision in the prompt reduces model confusion.

### R6. Retire the V1 identification path (medium priority)

**Problem.** `profiler.ts` still supports `promptVersion: "v1"`, which uses `buildProfilePrompt` + `ProfileResponseSchema` (8 flat fields). The V1 path produces free strings that don't match V2 enums, and the migration is lossy.

**Recommendation.** Remove the V1 path from `profiler.ts` once all callers use V2. Remove `buildProfilePrompt` and `ProfileResponseSchema` from `profilePrompts.ts`. Keep `migrateSemanticStyleFromV1` for state migration (v13 stores) until state v15.

**Justification.** Two identification paths produce two different type systems for the same concepts. Retiring V1 eliminates the mismatch.

### R7. Consolidate `ENUM_OPTIONS` and `DIMENSION_ENUMS` (low priority)

**Problem.** Two copies of the same enum list exist in `profilePrompts.ts` and `reviewPrompt.ts`.

**Recommendation.** Extract a shared `SEMANTIC_ENUM_OPTIONS` constant (in `SemanticStyleProfile.ts` or a new `src/analysis/semantic/enums.ts`) and import it in both prompt builders.

**Justification.** Single source of truth; eliminates manual sync.

### R8. Resolve duplicate parameters (medium priority)

**Problem.** Several parameters describe the same phenomenon (see §5.2).

**Recommendation.**

- **D1:** Remove `agency.passiveTendency`. Keep `voice.construction` as single source of truth.
- **D2:** Merge `sentenceArchitecture.complexity` and `clauseDensity` into one field (`complexity`).
- **D3:** Merge or clarify `uncertaintyStyle.modality` and `qualificationStyle.frequency`.
- **D4, D5, D6:** Keep but document the distinction. Add Zod `.refine()` constraints where appropriate.

**Justification.** Single source of truth; avoids contradictory profiles.

### R9. Add missing high-priority dimensions (medium priority)

**Problem.** Rhythm/variability is measured (`sentenceLengthStdDev`) but has no semantic counterpart. Cohesion, stance, and engagement are entirely missing.

**Recommendation.**

- **M1 (high):** Add `rhythm` dimension (sentenceVariability, paragraphVariability) as 17th dimension or sub-fields.
- **M2–M4 (medium):** Add `cohesion`, `stance`, `engagement` dimensions in a future phase.

**Justification.** These are recognized stylistic features (Crystal, Halliday, Hyland) that improve the profile's ability to characterize a body of text.

### R10. Refine unnecessary fields (low priority)

**Problem.** Several fields are overly specific or could be folded (see §5.3).

**Recommendation.**

- **U5:** Remove `conclusionStyle.avoidsRepetition` or convert to enum.
- **U6:** Convert `prefersNeutralVerbs` to enum or fold into `evaluativeLanguage`.
- **U7:** Convert `explainsTerms` to enum.
- **U8:** Merge `attributionPrecision` into `evidenceFraming.attribution`.
- **U9:** Keep `exceptions` but consider renaming dimension.

**Justification.** Consistency in granularity (enums over booleans) improves comparability and reduces schema complexity.

### R11. Expose all 30+ parameters in the profile editor (high priority)

**Problem.** `SemanticProfileEditor.tsx` only shows ~15 fields out of ~49 leaves. Many parameters (tone.secondary, tone.description, voice.description, formality.label, register.description, assertionStyle.ordering, assertionStyle.directness, qualificationStyle.strength, qualificationStyle.exceptions, qualificationStyle.conditionals, evidenceFraming.recordFirst, evidenceFraming.attribution, evidenceFraming.quotation, evidenceFraming.explicitReferences, uncertaintyStyle.confidenceLanguage, uncertaintyStyle.modality, uncertaintyStyle.avoidsUnsupportedCertainty, sentenceArchitecture.complexity, sentenceArchitecture.clauseDensity, sentenceArchitecture.coordination, sentenceArchitecture.shortClosingSentence, paragraphArchitecture.function, paragraphArchitecture.ordering, paragraphArchitecture.propositions, agency.passiveTendency, agency.attributionPrecision, technicality.density, technicality.explainsTerms, technicality.abbreviationTendency, conclusionStyle.avoidsRepetition, lexicalPreferences.prefersNeutralVerbs, lexicalPreferences.evaluativeLanguage) are not editable in the UI.

**Recommendation.** Add controls for all parameters. Convert `Dropdown` to `Combobox` (editable, with generic options) so the user can type custom values. The "pull in identified style" button already exists as "Use as preferred style" in `SelectedTextStyle.tsx` (calls `onUse` → `useIdentified` → `persistSemantic`), so no new button is needed — only the combobox conversion and full parameter exposure. The combobox conversion must preserve the existing pull-in behavior: typing a custom value into a combobox should not break the "Use as preferred style" flow.

**Justification.** The user cannot edit parameters that are not exposed. The profile editor should be the single place to view and edit all semantic parameters. Comboboxes allow both selection from generic options and free-text entry.

### R12. Remove "Sample diagnostics" section from Semantic Style page (medium priority)

**Problem.** The "Sample diagnostics" section shows measured metrics (avgSentenceLength, sentenceLengthStdDev, etc.) that do not control Semantic Review. They are collapsed by default but still add clutter.

**Recommendation.** Remove the section entirely. Measured metrics are available on the Deterministic Style Profile tab if needed.

**Justification.** Reduces clutter; the section does not govern Semantic Review.

### R13. Remove "Use this style" section from Semantic Style page (medium priority)

**Problem.** The "Use this style" section has a "Make this active" button. But `publishDraft` in `ProfileRecordSection` both publishes _and_ activates — it sets `activePublishedRevision` on the record (see `src/core/domain/ProfileRecord.ts` line 215). So the standalone "Make this active" button is not just redundant; it is a strict subset of what publish already does.

**Recommendation.** Remove the section. Activation is handled by `ProfileRecordSection` (publish draft publishes and activates in one call). The "Make this active" button adds nothing publish does not already do.

**Justification.** Single application point; reduces confusion. `publishDraft` already activates the published revision, so a separate activation button is dead UI.

### R14. Derive `formality.label` from score ranges or remove it (medium priority)

**Problem.** `formality.label` is a free-text field (≤40 chars) that duplicates `formality.score` (D4 partial duplicate). It is not leakage-checked (R1 gap), so it is both redundant and a leak surface. The score is what rules compare; the label is human-readable only.

**Recommendation.** Either:

- **Derive** `formality.label` from `formality.score` ranges (0–25: informal, 26–50: neutral, 51–75: formal, 76–100: highly formal), making it a computed field rather than free text; or
- **Remove** `formality.label` entirely and rely on `formality.score` as the single source of truth.

If derived, add it to `extractionFreeText()` (R1) so the computed label is leakage-checked. If removed, update `SemanticStyleProfileSchema`, `SemanticStyleExtractionSchema`, `ENUM_OPTIONS`, and `DIMENSION_ENUMS` consistently.

**Justification.** A free-text label for a numeric score is redundant, unchecked for leakage, and invites inconsistency between the label and the score. Deriving it eliminates both problems.

---

## 7. Summary

| Category                                          | Count                                                                      | Examples                                                                                                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aligned parameters                                | 16 dimensions + 8 booleans + 2 arrays + 4 free-text fields + 3 meta fields | All 16 dimensions, all enums, all ranges match between extraction and profile.                                                                                                                 |
| Gaps (identification doesn't cover profile field) | 1                                                                          | `formality.label` (not leakage-checked).                                                                                                                                                       |
| Mismatches                                        | 3                                                                          | Soft contract tension; `tone.secondary` wording; V1 path still live (deprecated).                                                                                                              |
| Redundancies                                      | 2                                                                          | `ENUM_OPTIONS` / `DIMENSION_ENUMS` duplicated; skeleton duplicated.                                                                                                                            |
| Asymmetries                                       | 3                                                                          | Hand-maintained prompt strings (drift risk); `notes` is user-only (by design); `formality.label` not leakage-checked.                                                                          |
| Documented gaps (V1→V2)                           | 2                                                                          | `readingGradeTarget`, `vocabularyRegister` (carried in `legacyV1`).                                                                                                                            |
| Duplicates (linguistic)                           | 6                                                                          | D1–D6 (passiveTendency/construction, complexity/clauseDensity, modality/qualification, formality/register, tone/rhetoricalStyle, technicality/register).                                       |
| Unnecessary fields                                | 9                                                                          | U1–U9 (formality.label, descriptions, avoidsRepetition, prefersNeutralVerbs, explainsTerms, attributionPrecision, exceptions).                                                                 |
| Missing dimensions                                | 12                                                                         | M1–M12 (rhythm, cohesion, stance, engagement, nominalization, temporal orientation, information structure, lexical density, sentence types, hedging types, argumentation, person consistency). |

**Bottom line.** The semantic identification process (V2) and the semantic profile parameters are **structurally aligned** — the extraction schema is derived from the persisted schema, the prompt's enum list matches the schema enums exactly, and the transform correctly merges extraction into the persisted shape. The remaining issues are: (1) `formality.label` is a free-text field not covered by the leakage check (R1, high priority); (2) the prompt strings are hand-maintained with no automated sync check (R4, drift risk); (3) several parameters are duplicates or unnecessary (R8, R10); (4) key dimensions are missing for identifying a body of text (R9); (5) the profile editor does not expose all 30+ parameters (R11). The V1 path is deprecated and should be removed (R6). The UI should be simplified by removing the "Sample diagnostics" and "Use this style" sections (R12, R13).
