/**
 * The strict schema a style-learning response must satisfy.
 *
 * **This is not the persisted profile shape, and reusing that shape here is the
 * defect this module exists to prevent.** `SemanticStyleProfileSchema` carries
 * `.default({})` on every group because a *stored record* has to tolerate
 * absence — that is what makes a v13 store parseable without a lossy read.
 * Those same defaults applied to a model's answer would turn "the model told us
 * nothing" into a confident "tone: neutral, register: professional, formality:
 * 50", persisted, and shown to the user as something that was learned. That is a
 * fabricated claim, and it is the failure this module is built to make
 * impossible.
 *
 * So every group is required, every leaf within a group is required, and no
 * field has a default. A sparse or evasive response throws at the point the user
 * can be told "the provider returned an empty analysis — try again", which is
 * true, rather than producing a profile that looks learned.
 *
 * The two schemas are then joined by one function, `toPersistedSemanticStyle`,
 * so there is exactly one place a group travels from the wire to the store.
 *
 * Boundary rule: this module may import `core/domain` and the local preservation
 * modules. It must not import a provider — it is the thing that decides whether
 * a provider's answer is usable.
 */

import { z } from "zod";

import {
  AgencyProfileSchema,
  AssertionStyleProfileSchema,
  ConclusionStyleProfileSchema,
  createEmptySemanticStyleProfile,
  EvidenceFramingProfileSchema,
  FormalityProfileSchema,
  isDefaultSemanticStyle,
  LexicalSemanticProfileSchema,
  ParagraphArchitectureProfileSchema,
  QualificationProfileSchema,
  RegisterProfileSchema,
  RhetoricalStyleProfileSchema,
  SentenceArchitectureProfileSchema,
  SemanticStyleProfileSchema,
  TechnicalityProfileSchema,
  ToneProfileSchema,
  TransitionProfileSchema,
  UncertaintyProfileSchema,
  VoiceProfileSchema,
  type SemanticStyleProfile,
} from "../../core/domain/SemanticStyleProfile";
import { extractProtectedFacts, findFactsPresentIn } from "./protectedFacts";

/**
 * The sixteen groups, each required, each declaring its leaves with no defaults
 * of its own.
 *
 * `.partial()` is what removes the defaults: a leaf that is `ZodDefault` inside
 * `ZodOptional` yields `undefined` rather than the default when the key is
 * absent. That is the whole mechanism, and it is why the schemas are not
 * restated by hand — a hand-written copy of sixteen groups would drift from the
 * persisted shape the first time a dimension is added.
 *
 * **What the strictness is, precisely: a group the model omits is a refusal; a
 * leaf it omits inside a group it did answer is filled from the persisted
 * default.** That is the right line. "The model told us nothing about evidence
 * framing" is a different answer from "the model told us the attribution is
 * occasional but not the rest", and only the first may be presented to the user
 * as a failure. What must never happen is the reverse — a *whole* group becoming
 * its default because the response was empty — and the group-level requirement
 * is what prevents it. A response that answers every group with defaults is
 * still caught, by `isDefaultSemanticStyle`.
 */
const REQUIRED_TONE = ToneProfileSchema.partial();
const REQUIRED_VOICE = VoiceProfileSchema.partial();
const REQUIRED_FORMALITY = FormalityProfileSchema.partial();
const REQUIRED_REGISTER = RegisterProfileSchema.partial();
const REQUIRED_ASSERTION = AssertionStyleProfileSchema.partial();
const REQUIRED_QUALIFICATION = QualificationProfileSchema.partial();
const REQUIRED_EVIDENCE = EvidenceFramingProfileSchema.partial();
const REQUIRED_UNCERTAINTY = UncertaintyProfileSchema.partial();
const REQUIRED_SENTENCE = SentenceArchitectureProfileSchema.partial();
const REQUIRED_PARAGRAPH = ParagraphArchitectureProfileSchema.partial();
const REQUIRED_TRANSITIONS = TransitionProfileSchema;
const REQUIRED_AGENCY = AgencyProfileSchema.partial();
const REQUIRED_TECHNICALITY = TechnicalityProfileSchema.partial();
const REQUIRED_RHETORICAL = RhetoricalStyleProfileSchema;
const REQUIRED_CONCLUSION = ConclusionStyleProfileSchema.partial();
const REQUIRED_LEXICAL = LexicalSemanticProfileSchema.partial();

export const SemanticStyleExtractionSchema = z.object({
  tone: REQUIRED_TONE,
  voice: REQUIRED_VOICE,
  formality: REQUIRED_FORMALITY,
  register: REQUIRED_REGISTER,
  assertionStyle: REQUIRED_ASSERTION,
  qualificationStyle: REQUIRED_QUALIFICATION,
  evidenceFraming: REQUIRED_EVIDENCE,
  uncertaintyStyle: REQUIRED_UNCERTAINTY,
  sentenceArchitecture: REQUIRED_SENTENCE,
  paragraphArchitecture: REQUIRED_PARAGRAPH,
  transitions: REQUIRED_TRANSITIONS,
  agency: REQUIRED_AGENCY,
  technicality: REQUIRED_TECHNICALITY,
  rhetoricalStyle: REQUIRED_RHETORICAL,
  conclusionStyle: REQUIRED_CONCLUSION,
  lexicalPreferences: REQUIRED_LEXICAL,
});
export type SemanticStyleExtraction = z.infer<typeof SemanticStyleExtractionSchema>;

/**
 * The message a refusal shows, and the one the tests assert on.
 *
 * One string, exported, because a refusal the user sees and a refusal a test
 * asserts on must be the same words — a test that pattern-matches its own copy
 * of the message proves nothing about what the product says.
 */
export const EMPTY_ANALYSIS_MESSAGE =
  "The provider returned an empty analysis — try again, or choose a longer sample.";

/** Why an extraction was refused. Distinct so a caller can act on each. */
export type ExtractionRefusal =
  | { readonly reason: "schema"; readonly message: string }
  | { readonly reason: "emptyAnalysis"; readonly message: string }
  | {
      readonly reason: "factualLeakage";
      readonly message: string;
      readonly tokens: readonly string[];
    };

/**
 * Every free-text value the model produced, concatenated.
 *
 * The leak surface, and the only place a model can put something it was told not
 * to carry over. `description` exists because some nuance will not fit an enum,
 * and that is exactly why a project name, a date, or a figure lands there.
 */
export function extractionFreeText(extraction: SemanticStyleExtraction): string {
  return [
    extraction.tone.description ?? "",
    extraction.voice.description ?? "",
    extraction.register.description ?? "",
    extraction.lexicalPreferences.toneAvoid?.join(" ") ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Validate a model's answer, reject an uninformative one, and reject a leaked
 * fact — in that order, because the order is what makes each refusal honest.
 *
 * Schema first: an unparseable answer cannot be inspected for anything.
 * Emptiness second: an all-default extraction is well-formed and says nothing.
 * Leakage third: an extraction that says something is worth inspecting, and the
 * sample is what it is inspected against.
 *
 * The leakage check is a **separate validation, not a schema guarantee.** Zod
 * cannot know that "the contractor was resourced to two gangs" is a project fact
 * rather than a stylistic observation, and the free-text fields are precisely
 * where it lands. What can be done deterministically is to extract the protected
 * tokens from the sample and look for them in what came back, which is what
 * `findFactsPresentIn` does.
 */
export function parseSemanticStyleExtraction(
  raw: unknown,
  sampleText: string,
): { ok: true; value: SemanticStyleProfile } | { ok: false; refusal: ExtractionRefusal } {
  const parsed = SemanticStyleExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).filter(Boolean);
    return {
      ok: false,
      refusal: {
        reason: "schema",
        message: `The provider returned a style analysis that is missing ${[
          ...new Set(fields),
        ].join(", ")}.`,
      },
    };
  }

  const extraction = parsed.data;

  const persisted = SemanticStyleProfileSchema.parse({
    ...createEmptySemanticStyleProfile(),
    tone: { ...createEmptySemanticStyleProfile().tone, ...stripUndefined(extraction.tone) },
    voice: { ...createEmptySemanticStyleProfile().voice, ...stripUndefined(extraction.voice) },
    formality: {
      ...createEmptySemanticStyleProfile().formality,
      ...stripUndefined(extraction.formality),
    },
    register: {
      ...createEmptySemanticStyleProfile().register,
      ...stripUndefined(extraction.register),
    },
    assertionStyle: {
      ...createEmptySemanticStyleProfile().assertionStyle,
      ...stripUndefined(extraction.assertionStyle),
    },
    qualificationStyle: {
      ...createEmptySemanticStyleProfile().qualificationStyle,
      ...stripUndefined(extraction.qualificationStyle),
    },
    evidenceFraming: {
      ...createEmptySemanticStyleProfile().evidenceFraming,
      ...stripUndefined(extraction.evidenceFraming),
    },
    uncertaintyStyle: {
      ...createEmptySemanticStyleProfile().uncertaintyStyle,
      ...stripUndefined(extraction.uncertaintyStyle),
    },
    sentenceArchitecture: {
      ...createEmptySemanticStyleProfile().sentenceArchitecture,
      ...stripUndefined(extraction.sentenceArchitecture),
    },
    paragraphArchitecture: {
      ...createEmptySemanticStyleProfile().paragraphArchitecture,
      ...stripUndefined(extraction.paragraphArchitecture),
    },
    transitions: extraction.transitions,
    agency: { ...createEmptySemanticStyleProfile().agency, ...stripUndefined(extraction.agency) },
    technicality: {
      ...createEmptySemanticStyleProfile().technicality,
      ...stripUndefined(extraction.technicality),
    },
    rhetoricalStyle: extraction.rhetoricalStyle,
    conclusionStyle: {
      ...createEmptySemanticStyleProfile().conclusionStyle,
      ...stripUndefined(extraction.conclusionStyle),
    },
    lexicalPreferences: {
      ...createEmptySemanticStyleProfile().lexicalPreferences,
      ...stripUndefined(extraction.lexicalPreferences),
    },
  });

  if (isDefaultSemanticStyle(persisted)) {
    return { ok: false, refusal: { reason: "emptyAnalysis", message: EMPTY_ANALYSIS_MESSAGE } };
  }

  const leaked = findFactsPresentIn(
    extractionFreeText(extraction),
    extractProtectedFacts(sampleText),
  );
  if (leaked.length > 0) {
    return {
      ok: false,
      refusal: {
        reason: "factualLeakage",
        tokens: leaked.map((fact) => fact.surface),
        message: `The provider repeated document content in the style description (${leaked
          .map((fact) => `"${fact.surface}"`)
          .join(", ")}). A style profile describes how the writing reads, not what it says.`,
      },
    };
  }

  return { ok: true, value: persisted };
}

/**
 * Drop absent leaves so the persisted schema's own defaults apply.
 *
 * Without this, `{...defaults, ...extraction}` would overwrite a default with
 * `undefined` for a leaf the model legitimately omitted, and the profile would
 * store `undefined` where the schema promises a value. Every leaf is required by
 * `SemanticStyleExtractionSchema`, so in practice nothing is dropped — the
 * helper exists so the merge stays correct if that ever stops being true.
 */
function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
