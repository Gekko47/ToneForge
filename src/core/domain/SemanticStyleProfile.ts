/**
 * Semantic Style Profile V2.
 *
 * The learned half of a `StyleProfile`, expressed as sixteen grouped dimensions
 * rather than the eight flat fields of V1. V1 could say "restrained, third-person,
 * formality 72" — enough to prompt a generic rewrite, and not enough to describe
 * how a construction or quantum expert actually writes.
 *
 * **Three rules govern this file.**
 *
 * 1. **Nothing here is deterministic.** No font, spacing, punctuation, quote or
 *    dash style, and no house terminology substitution. Those belong to
 *    `DeterministicStyleProfileSchema`, which deliberately omits `semantic`. A
 *    semantic profile that could specify a dash would let the model answer a
 *    question the rules engine already answers better, and a change made under
 *    the model's authority would carry no governance trail.
 *
 * 2. **Every field defaults, because this is the persisted shape.** A stored
 *    record must tolerate absence: that is what makes a v13 store parseable
 *    without a lossy read, and what `migrateV13ToV14` relies on. The
 *    consequence is that this schema **must never be used to validate a model's
 *    answer** — a sparse response would parse here into a fully default-filled
 *    profile and the user would be shown "tone: neutral, register: professional"
 *    as though it had been learned. Model output is validated against
 *    `SemanticStyleExtractionSchema` (P2), which has no defaults, and is then
 *    transformed into this shape.
 *
 * 3. **The free-text fields are the leak surface.** `description` and `notes`
 *    exist because some nuance will not fit an enum, and they are exactly where
 *    a model puts a project name, a date, or a figure it was told not to carry
 *    over. That is why they are length-bounded here and checked for factual
 *    leakage in P2 — the check is a separate validation, not something a schema
 *    can express.
 *
 * Boundary rule: `core/domain` imports zod and `shared/utils` only, never `ai`,
 * `word`, or UI.
 */

import { z } from "zod";

/** The version stamped on every V2 profile, and asserted on read. */
export const SEMANTIC_STYLE_SCHEMA_VERSION = 2;

/**
 * The V1 semantic block, retained so a v13 store can be mapped forward.
 *
 * **Declared here rather than in `StyleProfile.ts` to keep the dependency
 * one-way.** `StyleProfile` embeds this V2 schema, so if V1 lived there too and
 * this module imported it, the two would import each other — the exact
 * uninitialised-binding hazard `profileSelectors.ts` documents for the CommonJS
 * interop the build uses. The direction is `StyleProfile` → `SemanticStyleProfile`
 * and nothing back; `StyleProfile` re-exports this schema for the migration's
 * convenience, so callers still have one import site to change when V1 is
 * retired in state v15.
 */
export const LegacySemanticProfileV1Schema = z.object({
  tone: z.string().trim().min(1).default("neutral"),
  voice: z.string().trim().min(1).default("third-person"),
  formality: z.number().min(0).max(100).default(50),
  readingGradeTarget: z.number().min(0).max(20).nullable().default(null),
  preferredSentenceLength: z.number().min(5).max(60).default(22),
  vocabularyRegister: z.enum(["simple", "standard", "technical", "academic"]).default("standard"),
  rhetoricalStyle: z.string().trim().min(1).default("direct"),
  avoidWords: z.array(z.string()).default([]),
});
export type LegacySemanticProfileV1 = z.infer<typeof LegacySemanticProfileV1Schema>;

// ---------------------------------------------------------------------------
// Individual dimensions
// ---------------------------------------------------------------------------

export const ToneTraitSchema = z.enum([
  "restrained",
  "neutral",
  "assertive",
  "cautious",
  "analytical",
  "forensic",
  "explanatory",
  "persuasive",
]);
export type ToneTrait = z.infer<typeof ToneTraitSchema>;

/**
 * Tone, with a primary and at most two secondaries.
 *
 * Bounded at two because a list of six tones describes an author having no tone.
 * The cap is a statement that a profile which cannot choose is not a profile.
 */
export const ToneProfileSchema = z.object({
  primary: ToneTraitSchema.default("neutral"),
  secondary: z.array(ToneTraitSchema).max(2).default([]),
  description: z.string().trim().max(240).default(""),
});
export type ToneProfile = z.infer<typeof ToneProfileSchema>;

export const VoiceProfileSchema = z.object({
  person: z.enum(["first", "third", "mixed", "impersonal"]).default("impersonal"),
  construction: z.enum(["active", "passive", "balanced"]).default("balanced"),
  authorialPresence: z.enum(["absent", "restrained", "explicit"]).default("restrained"),
  description: z.string().trim().max(240).default(""),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

/**
 * Formality is a bounded score **and** a label.
 *
 * Both, because the score is what a rule can compare and the label is what a
 * person reads. A profile saying "78" is unusable in an editor and a profile
 * saying "formal" cannot be reasoned about numerically.
 */
export const FormalityProfileSchema = z.object({
  score: z.number().int().min(0).max(100).default(50),
  label: z.string().trim().max(40).default(""),
});
export type FormalityProfile = z.infer<typeof FormalityProfileSchema>;

export const RegisterProfileSchema = z.object({
  primary: z
    .enum(["plain", "professional", "technical", "expert", "academic", "legal-technical"])
    .default("professional"),
  description: z.string().trim().max(240).default(""),
});
export type RegisterProfile = z.infer<typeof RegisterProfileSchema>;

export const AssertionStyleProfileSchema = z.object({
  strength: z.enum(["categorical", "qualified", "conditional", "provisional"]).default("qualified"),
  ordering: z.enum(["evidence-first", "conclusion-first", "interleaved"]).default("evidence-first"),
  directness: z.enum(["direct", "measured", "indirect"]).default("measured"),
});
export type AssertionStyleProfile = z.infer<typeof AssertionStyleProfileSchema>;

export const QualificationProfileSchema = z.object({
  frequency: z.enum(["rare", "occasional", "frequent"]).default("occasional"),
  strength: z.enum(["light", "moderate", "heavy"]).default("moderate"),
  exceptions: z.enum(["none", "inline", "dedicated"]).default("inline"),
  conditionals: z.boolean().default(true),
});
export type QualificationProfile = z.infer<typeof QualificationProfileSchema>;

/**
 * How evidence is introduced.
 *
 * `recordFirst` is the field that carries most of an expert report's shape: the
 * contemporaneous record, then the analysis, then the opinion. Its inverse — the
 * conclusion ahead of the evidence — is the single most reliable way to
 * distinguish an assertive writer from a forensic one, and V1 had nowhere to
 * record it.
 */
export const EvidenceFramingProfileSchema = z.object({
  recordFirst: z.boolean().default(true),
  attribution: z.enum(["none", "occasional", "systematic"]).default("occasional"),
  quotation: z.enum(["rare", "selective", "frequent"]).default("selective"),
  explicitReferences: z.boolean().default(false),
  progression: z
    .enum(["source-analysis-conclusion", "claim-evidence", "narrative"])
    .default("source-analysis-conclusion"),
});
export type EvidenceFramingProfile = z.infer<typeof EvidenceFramingProfileSchema>;

export const UncertaintyProfileSchema = z.object({
  incompleteEvidence: z.enum(["stated", "implied", "suppressed"]).default("stated"),
  confidenceLanguage: z.enum(["explicit", "implicit", "absent"]).default("explicit"),
  modality: z.enum(["frequent", "occasional", "rare"]).default("occasional"),
  avoidsUnsupportedCertainty: z.boolean().default(true),
});
export type UncertaintyProfile = z.infer<typeof UncertaintyProfileSchema>;

export const SentenceArchitectureProfileSchema = z.object({
  complexity: z.enum(["simple", "moderate", "complex"]).default("moderate"),
  clauseDensity: z.enum(["low", "medium", "high"]).default("medium"),
  /**
   * The preferred length band, in words.
   *
   * Bounded to 5–60 for the same reason V1 bounded `preferredSentenceLength` to
   * the same range: a "preferred" sentence length above 60 words is not a
   * preference but an accident of the sample, and below 5 is not prose.
   */
  targetWords: z.number().int().min(5).max(60).default(22),
  coordination: z.enum(["coordination", "subordination", "mixed"]).default("mixed"),
  shortClosingSentence: z.boolean().default(false),
});
export type SentenceArchitectureProfile = z.infer<typeof SentenceArchitectureProfileSchema>;

export const ParagraphArchitectureProfileSchema = z.object({
  function: z.enum(["topic", "evidence", "analysis", "conclusion", "mixed"]).default("mixed"),
  ordering: z
    .enum(["topic-evidence-conclusion", "conclusion-evidence", "chronological", "comparative"])
    .default("topic-evidence-conclusion"),
  targetWords: z.number().int().min(20).max(400).default(90),
  propositions: z.enum(["single", "multiple"]).default("single"),
});
export type ParagraphArchitectureProfile = z.infer<typeof ParagraphArchitectureProfileSchema>;

/**
 * Transitions are a scalar, not an object.
 *
 * A rare deliberate exception to the one-object-per-dimension shape, because
 * "how often does the author signpost, and how loudly" has no second axis worth
 * naming — `evidenceFraming.progression` already records _what_ the transitions
 * connect.
 */
export const TransitionProfileSchema = z.enum(["restrained", "explicit", "rhetorical"]);
export type TransitionStyle = z.infer<typeof TransitionProfileSchema>;

export const AgencyProfileSchema = z.object({
  actorNaming: z.enum(["named", "role", "impersonal", "mixed"]).default("named"),
  passiveTendency: z.enum(["low", "medium", "high"]).default("low"),
  attributionPrecision: z.enum(["exact", "general", "unspecified"]).default("exact"),
});
export type AgencyProfile = z.infer<typeof AgencyProfileSchema>;

export const TechnicalityProfileSchema = z.object({
  density: z.enum(["low", "medium", "high"]).default("medium"),
  explainsTerms: z.boolean().default(true),
  abbreviationTendency: z.enum(["none", "first-use", "permissive"]).default("first-use"),
});
export type TechnicalityProfile = z.infer<typeof TechnicalityProfileSchema>;

export const RhetoricalStyleProfileSchema = z.enum([
  "direct-analytical",
  "narrative",
  "forensic",
  "comparative",
  "argumentative",
  "explanatory",
]);
export type RhetoricalStyleValue = z.infer<typeof RhetoricalStyleProfileSchema>;

/**
 * The V2 rhetorical-style values, as a runtime set.
 *
 * Exported because a V1 store held `rhetoricalStyle` as a free string, and the
 * governance migration has to decide at runtime whether a stored value names a V2
 * trait or nothing at all. A type cannot answer that.
 */
export const RHETORICAL_STYLE_VALUES: ReadonlySet<string> = new Set(
  RhetoricalStyleProfileSchema.options,
);

export const ConclusionStyleProfileSchema = z.object({
  form: z.enum(["concise", "qualified", "recap", "opinion", "none"]).default("qualified"),
  avoidsRepetition: z.boolean().default(true),
});
export type ConclusionStyleProfile = z.infer<typeof ConclusionStyleProfileSchema>;

/**
 * Semantic lexical preferences — tone only.
 *
 * `toneAvoid` is for words an author avoids because of how they sound, not
 * because a house style substitutes them. Deterministic terminology rules live in
 * `language.terminology` and are enforced by a rule with a governance trail; a
 * word in this list is a style tendency, carried into a prompt and nothing more.
 */
export const LexicalSemanticProfileSchema = z.object({
  toneAvoid: z.array(z.string().trim().min(1)).max(100).default([]),
  prefersNeutralVerbs: z.boolean().default(true),
  evaluativeLanguage: z.enum(["none", "restrained", "explicit"]).default("restrained"),
});
export type LexicalSemanticProfile = z.infer<typeof LexicalSemanticProfileSchema>;

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

/**
 * V1 values with no exact V2 home, carried verbatim.
 *
 * The v14 migration writes here anything it cannot map, so a profile the user
 * learned is never silently degraded into a default one. The engine never reads
 * this object; it exists so the editor can say what the profile used to say, and
 * so `recallRevisionAsDraft` has something to restore. Removed in state v15 with
 * an ADR.
 */
export const LegacySemanticV1Schema = z.object({
  /** No V2 home: a readability measure, not a style trait. */
  readingGradeTarget: z.number().min(0).max(20).nullable().default(null),
  /** Mapped to `register.primary` on a best-effort basis; kept for the same reason. */
  vocabularyRegister: z.enum(["simple", "standard", "technical", "academic"]).default("standard"),
  /** The original free strings, kept where the enum mapping could not be trusted. */
  tone: z.string().default(""),
  voice: z.string().default(""),
  rhetoricalStyle: z.string().default(""),
});
export type LegacySemanticV1 = z.infer<typeof LegacySemanticV1Schema>;

export const SemanticStyleProfileSchema = z.object({
  schemaVersion: z.literal(SEMANTIC_STYLE_SCHEMA_VERSION).default(SEMANTIC_STYLE_SCHEMA_VERSION),
  tone: ToneProfileSchema.default({}),
  voice: VoiceProfileSchema.default({}),
  formality: FormalityProfileSchema.default({}),
  register: RegisterProfileSchema.default({}),
  assertionStyle: AssertionStyleProfileSchema.default({}),
  qualificationStyle: QualificationProfileSchema.default({}),
  evidenceFraming: EvidenceFramingProfileSchema.default({}),
  uncertaintyStyle: UncertaintyProfileSchema.default({}),
  sentenceArchitecture: SentenceArchitectureProfileSchema.default({}),
  paragraphArchitecture: ParagraphArchitectureProfileSchema.default({}),
  transitions: TransitionProfileSchema.default("restrained"),
  agency: AgencyProfileSchema.default({}),
  technicality: TechnicalityProfileSchema.default({}),
  rhetoricalStyle: RhetoricalStyleProfileSchema.default("direct-analytical"),
  conclusionStyle: ConclusionStyleProfileSchema.default({}),
  lexicalPreferences: LexicalSemanticProfileSchema.default({}),
  notes: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
  /**
   * Absent on any profile created after v14, and present on a migrated one.
   *
   * Optional rather than defaulted, so its presence is itself the signal that
   * this profile came through a migration and its un-mappable values are intact.
   * Defaulting it to `{}` would make "nothing was carried" indistinguishable
   * from "nothing needed carrying".
   */
  legacyV1: LegacySemanticV1Schema.optional(),
});
export type SemanticStyleProfile = z.infer<typeof SemanticStyleProfileSchema>;

/**
 * The sixteen dimension names, in the order the editor groups them.
 *
 * Exported as data rather than kept implicit, because the review assessment, the
 * editor sections, and the P0 fixture all need to agree on the set. A dimension
 * that exists in the schema and not in this list is one no surface can render.
 */
export const SEMANTIC_DIMENSIONS = [
  "tone",
  "voice",
  "formality",
  "register",
  "assertionStyle",
  "qualificationStyle",
  "evidenceFraming",
  "uncertaintyStyle",
  "sentenceArchitecture",
  "paragraphArchitecture",
  "transitions",
  "agency",
  "technicality",
  "rhetoricalStyle",
  "conclusionStyle",
  "lexicalPreferences",
] as const;
export type SemanticDimension = (typeof SEMANTIC_DIMENSIONS)[number];

/**
 * Whether every field in a profile still holds its default.
 *
 * Used by P2 to refuse "the model returned an empty analysis" rather than
 * persisting it. It reads the parsed object, so it is a statement about a value
 * rather than about an absence in the source.
 */
export function isDefaultSemanticStyle(profile: SemanticStyleProfile): boolean {
  return (
    profile.tone.primary === "neutral" &&
    profile.tone.secondary.length === 0 &&
    profile.tone.description === "" &&
    profile.voice.person === "impersonal" &&
    profile.voice.construction === "balanced" &&
    profile.voice.authorialPresence === "restrained" &&
    profile.voice.description === "" &&
    profile.formality.score === 50 &&
    profile.formality.label === "" &&
    profile.register.primary === "professional" &&
    profile.register.description === "" &&
    profile.assertionStyle.strength === "qualified" &&
    profile.assertionStyle.ordering === "evidence-first" &&
    profile.assertionStyle.directness === "measured" &&
    profile.qualificationStyle.frequency === "occasional" &&
    profile.qualificationStyle.strength === "moderate" &&
    profile.qualificationStyle.exceptions === "inline" &&
    profile.qualificationStyle.conditionals === true &&
    profile.evidenceFraming.recordFirst === true &&
    profile.evidenceFraming.attribution === "occasional" &&
    profile.evidenceFraming.quotation === "selective" &&
    profile.evidenceFraming.explicitReferences === false &&
    profile.evidenceFraming.progression === "source-analysis-conclusion" &&
    profile.uncertaintyStyle.incompleteEvidence === "stated" &&
    profile.uncertaintyStyle.confidenceLanguage === "explicit" &&
    profile.uncertaintyStyle.modality === "occasional" &&
    profile.uncertaintyStyle.avoidsUnsupportedCertainty === true &&
    profile.sentenceArchitecture.complexity === "moderate" &&
    profile.sentenceArchitecture.clauseDensity === "medium" &&
    profile.sentenceArchitecture.targetWords === 22 &&
    profile.sentenceArchitecture.coordination === "mixed" &&
    profile.sentenceArchitecture.shortClosingSentence === false &&
    profile.paragraphArchitecture.function === "mixed" &&
    profile.paragraphArchitecture.ordering === "topic-evidence-conclusion" &&
    profile.paragraphArchitecture.targetWords === 90 &&
    profile.paragraphArchitecture.propositions === "single" &&
    profile.transitions === "restrained" &&
    profile.agency.actorNaming === "named" &&
    profile.agency.passiveTendency === "low" &&
    profile.agency.attributionPrecision === "exact" &&
    profile.technicality.density === "medium" &&
    profile.technicality.explainsTerms === true &&
    profile.technicality.abbreviationTendency === "first-use" &&
    profile.rhetoricalStyle === "direct-analytical" &&
    profile.conclusionStyle.form === "qualified" &&
    profile.conclusionStyle.avoidsRepetition === true &&
    profile.lexicalPreferences.toneAvoid.length === 0 &&
    profile.lexicalPreferences.prefersNeutralVerbs === true &&
    profile.lexicalPreferences.evaluativeLanguage === "restrained" &&
    profile.notes.length === 0
  );
}

/**
 * A blank V2 profile, parsed so the defaults are the schema's and not this
 * module's restatement of them.
 */
export function createEmptySemanticStyleProfile(): SemanticStyleProfile {
  return SemanticStyleProfileSchema.parse({});
}

/**
 * Whether a stored block is V1 rather than V2.
 *
 * **Structural, not version-stamped.** `schemaVersion` would be the obvious
 * discriminator and it is deliberately not used: a v13 store's block predates the
 * field, so it arrives with no `schemaVersion` at all, and "absent" has to mean
 * V1 for exactly that case. Reading the shape instead also means a block that
 * *was* stamped and then hand-edited is still recognised.
 *
 * The test is on value types rather than key presence. V1 `tone` is a string and
 * V2 `tone` is an object; V1 `formality` is a number and V2 `formality` is an
 * object. Those cannot coincide, so the check cannot be confused by a V2 profile
 * that happens to be all defaults. `avoidWords` is included as a third witness
 * because it is the one V1 field whose value type — a string array — is unique to
 * V1 and is the field a governance author is most likely to have set.
 */
function isLegacySemanticStyleBlock(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  return (
    typeof block.tone === "string" ||
    typeof block.voice === "string" ||
    typeof block.formality === "number" ||
    Array.isArray(block.avoidWords)
  );
}

/**
 * The field as it is read from a store: V1 in, V2 out.
 *
 * **This is where the V1 -> V2 upgrade lives, and it is in the schema rather than
 * in `migrateV13ToV14` for a concrete reason.** Every migration step in
 * `migration.ts` — v7, v8, v9, v10, v11, v12, and the current version — ends by
 * calling `readCurrentState`, and a v7 store's profile carries a V1 semantic block
 * just as much as a v13 store's. A migration step keyed on the *state* version
 * would therefore have to be duplicated fourteen times to cover a change in the
 * *profile* shape, and any one of them forgotten would silently drop the user's
 * profiles: `ProfileRecordSchema.safeParse` fails on an unrecognised block and
 * `readProfileRecords` skips it without complaint (ADR-0010's "no startup crash"
 * behaving correctly and hiding the loss).
 *
 * Putting it here means one implementation, on every read path — migration,
 * persistence, governance snapshots, the revision trail — and one place to delete
 * in state v15. The cost is that the domain schema is no longer a pure
 * description of V2; that is stated rather than hidden, and the pure-V2 schema
 * stays exported for callers that genuinely have V2 in hand.
 */
export const StoredSemanticStyleSchema = z.preprocess(
  (value) => (isLegacySemanticStyleBlock(value) ? migrateSemanticStyleFromV1(value) : value),
  SemanticStyleProfileSchema,
);
export type StoredSemanticStyle = z.output<typeof StoredSemanticStyleSchema>;

/**
 * Map a V1 semantic block onto V2 without losing anything.
 *
 * **Six fields map; three are carried rather than mapped.** The specification
 * requires a migration to "never silently discard learned profile information",
 * and the honest way to honour that is to admit where V2 has no home for a value
 * instead of inventing one. `readingGradeTarget` is a readability measure, not a
 * style trait. `vocabularyRegister` has a nearest match in `register.primary` but
 * not an exact one, so it is mapped best-effort *and* preserved. The three free
 * strings are kept verbatim in `description` and in `legacyV1`, because an enum
 * mapping that guessed would be an invented claim about an author's voice.
 *
 * One implementation serves both callers — the v14 state migration and the V1
 * learning path in `profiler.ts` — so a profile migrated from a v13 store and one
 * learned today reach V2 by identical rules. Two implementations would be two
 * answers to "what did V1 mean", and they would drift.
 */
export function migrateSemanticStyleFromV1(input: unknown): SemanticStyleProfile {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const v1 = LegacySemanticProfileV1Schema.parse(raw);

  /*
   * A V1 free string becomes a V2 `description` only when the block actually
   * carried one.
   *
   * `LegacySemanticProfileV1Schema` defaults `tone` to `"neutral"`, so parsing an
   * absent block yields "neutral" — and copying that into `tone.description`
   * would render "neutral" as a description the author wrote, on a profile that
   * says nothing at all. The description is the field that holds what the enum
   * could not be trusted to express, and a schema default is not an author's
   * voice.
   */
  const described = (field: "tone" | "voice" | "rhetoricalStyle"): string =>
    typeof raw[field] === "string" ? String(raw[field]) : "";

  const registerFrom = (value: LegacySemanticProfileV1["vocabularyRegister"]) =>
    value === "academic"
      ? ("academic" as const)
      : value === "technical"
        ? ("technical" as const)
        : value === "simple"
          ? ("plain" as const)
          : ("professional" as const);

  return SemanticStyleProfileSchema.parse({
    tone: { primary: "neutral", secondary: [], description: described("tone") },
    voice: {
      person: "impersonal",
      construction: "balanced",
      authorialPresence: "restrained",
      description: described("voice"),
    },
    formality: { score: Math.round(v1.formality), label: "" },
    register: { primary: registerFrom(v1.vocabularyRegister), description: "" },
    sentenceArchitecture: {
      complexity: "moderate",
      clauseDensity: "medium",
      targetWords: v1.preferredSentenceLength,
      coordination: "mixed",
      shortClosingSentence: false,
    },
    rhetoricalStyle:
      v1.rhetoricalStyle === "direct"
        ? ("direct-analytical" as const)
        : v1.rhetoricalStyle === "forensic"
          ? ("forensic" as const)
          : ("direct-analytical" as const),
    lexicalPreferences: {
      toneAvoid: v1.avoidWords,
      prefersNeutralVerbs: true,
      evaluativeLanguage: "restrained",
    },
    notes: [],
    legacyV1: {
      readingGradeTarget: v1.readingGradeTarget,
      vocabularyRegister: v1.vocabularyRegister,
      tone: described("tone"),
      voice: described("voice"),
      rhetoricalStyle: described("rhetoricalStyle"),
    },
  });
}

/**
 * The V2 dimensions a v13 store's editorial policy was actually governing.
 *
 * The V1 rule was "a normative value wins when the author set it, or when it
 * differs from the schema default", and `explicitFields` did not exist before
 * v12 — so a v13 record's pins are *computed* here rather than carried. A
 * migrated policy therefore governs exactly what it governed before and not one
 * dimension more.
 *
 * `vocabularyRegister` and `readingGradeTarget` are absent from the mapping on
 * purpose: V2 has no dimension for either, so a policy that set them governs
 * nothing. That is surfaced by the migration test rather than hidden, because a
 * silent loss here is exactly the D2/R1 regression in a different form.
 */
export function v1EditorialPins(input: unknown): string[] {
  const raw = z.record(z.string(), z.unknown()).safeParse(input ?? {});
  if (!raw.success) return [];
  const stored = raw.data;
  const defaults: Record<string, unknown> = LegacySemanticProfileV1Schema.parse({});
  const pins: string[] = [];

  const mapping: ReadonlyArray<readonly [string, SemanticDimension]> = [
    ["tone", "tone"],
    ["voice", "voice"],
    ["formality", "formality"],
    ["preferredSentenceLength", "sentenceArchitecture"],
    ["rhetoricalStyle", "rhetoricalStyle"],
    ["avoidWords", "lexicalPreferences"],
  ];

  mapping.forEach(([v1Field, dimension]) => {
    const value = stored[v1Field];
    if (value === undefined) return;
    if (JSON.stringify(value) !== JSON.stringify(defaults[v1Field])) pins.push(dimension);
  });

  return pins;
}
