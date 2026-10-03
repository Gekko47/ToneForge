/**
 * GovernanceProfile — policy envelope wrapping StyleProfile plus
 * rule sets, terminology, scope, protection, editorial, and provenance.
 *
 * Boundary rule: core/domain must not import from `word`, `ai`, or `ui`.
 */

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { StyleProfileSchema, type StyleProfile } from "./StyleProfile";
import {
  RHETORICAL_STYLE_VALUES,
  SEMANTIC_DIMENSIONS,
  v1EditorialPins,
  V1_EDITORIAL_FIELD_DIMENSIONS,
  ToneTraitSchema,
  ToneProfileSchema,
  VoiceProfileSchema,
  FormalityProfileSchema,
  RegisterProfileSchema,
  AssertionStyleProfileSchema,
  QualificationProfileSchema,
  EvidenceFramingProfileSchema,
  UncertaintyProfileSchema,
  SentenceArchitectureProfileSchema,
  ParagraphArchitectureProfileSchema,
  TransitionProfileSchema,
  AgencyProfileSchema,
  TechnicalityProfileSchema,
  RhetoricalStyleProfileSchema,
  ConclusionStyleProfileSchema,
  LexicalSemanticProfileSchema,
} from "./SemanticStyleProfile";

export const ScopePolicySchema = z.object({
  includeBody: z.boolean().default(true),
  includeHeadersFooters: z.boolean().default(false),
  includeComments: z.boolean().default(false),
  includeFootnotesEndnotes: z.boolean().default(false),
  includeTextBoxes: z.boolean().default(false),
  includeShapes: z.boolean().default(false),
  includeSmartArt: z.boolean().default(false),
  includeContentControls: z.boolean().default(false),
  includeFields: z.boolean().default(false),
  includeImages: z.boolean().default(false),
  includeTables: z.boolean().default(true),
  /*
   * Section geometry, added with the section scope in T20.
   *
   * Without a flag here the `sections` scope could never be *requested*, so it
   * could never be a coverage blocker either, and `coverage.ts` reported the
   * scope as neither examined nor excluded — the "asked for nothing, so nothing
   * is missing" case that reads as complete. Spec §8.5 gates sections the same
   * way it gates headers and footers: in by default, and the author's to turn off.
   *
   * A defaulted field, so no migration is needed — that is what `.default()` is
   * for, and the spec's "no back-migration" answer is honoured by construction
   * rather than by a migration step.
   */
  includeSections: z.boolean().default(true),
  includeLists: z.boolean().default(true),
  /*
   * Scopes the author will not accept a partial answer for.
   *
   * Spec §9 and §27 gate 12: coverage has to *prevent* a false-compliance
   * claim, which it can only do for a scope somebody insisted on. Every other
   * scope is a limitation the report states and moves past — a document whose
   * tables could not be read is not a document whose body was not checked, and
   * refusing Apply over it would train the user to ignore the verdict.
   *
   * `body` is mandatory by construction rather than by configuration: a run
   * that examined part of the body cannot speak for the document whatever the
   * policy says, and `coverage.ts` adds that blocker on its own. The author
   * chooses the *rest* — and the honest default is the body plus the structures
   * the checks for them exist.
   *
   * A closed `ScopeKind` list rather than free strings, because an unrecognised
   * entry would silently never match a scope and would be a setting that
   * changes nothing — the §11 failure in a different place.
   */
  mandatoryScopes: z
    .array(
      z.enum([
        "body",
        "headings",
        "lists",
        "tables",
        "sections",
        "headersFooters",
        "textBoxes",
        "fields",
        "contentControls",
        "shapes",
      ]),
    )
    .default(["body", "headings"]),
});

export type ScopePolicy = z.infer<typeof ScopePolicySchema>;

export const ProtectionPolicySchema = z.object({
  protectQuotedText: z.boolean().default(true),
  protectCaptions: z.boolean().default(true),
  protectTrackedDeletions: z.boolean().default(true),
  protectComments: z.boolean().default(true),
  protectTextBoxes: z.boolean().default(true),
  protectShapes: z.boolean().default(true),
  protectAltText: z.boolean().default(true),
  protectHeadersFooters: z.boolean().default(false),
  protectFields: z.boolean().default(false),
  protectFootnotes: z.boolean().default(false),
  /**
   * Document node ids the author has locked.
   *
   * These are Word node ids, not UUIDs. Typing them as UUIDs meant the field
   * could never match anything `isProtectedNode` compared it against, so a
   * locked range was silently unprotected — the same defect as a toggle that
   * changes nothing, one level down.
   */
  userLockedRanges: z.array(z.string().trim().min(1)).default([]),
});

export type ProtectionPolicy = z.infer<typeof ProtectionPolicySchema>;

/**
 * Governance governs *protection and editability*, not wording.
 *
 * The `TerminologyPolicySchema` this replaces carried preferred terms, banned
 * terms, required terms and a locale. None of them is a governance concern:
 * governance decides what may be changed and what must be left alone, while house
 * wording is a deterministic-review standard (owner decision, and the ADR recorded
 * with this change).
 *
 * The evidence that the split is real rather than a preference: a search of
 * `src/ai/` returns **no** reference to terminology at all, so none of these fields
 * ever fed the semantic pipeline. Their only consumers were `resolveHouseStyle` and
 * `resolveLanguage`, which exist purely to hand wording to deterministic rules.
 *
 * Two of the four were dead even there. `requiredTerms` and `locale` were editable
 * in `GovernancePolicySection.tsx` and read by no code - two settings in the
 * governance contract that governed nothing, the same defect class as a profile
 * field with no rule.
 *
 * They are therefore relocated rather than migrated: `requiredTerms` becomes
 * `language.requiredTerms` on the deterministic profile (D1), the rest are authored
 * there too, and none requires a data migration because the deterministic profile
 * is a separate record with its own defaults.
 */

/**
 * The dimensions a governance author can pin, which are the sixteen semantic
 * dimensions and nothing else.
 *
 * **Expanded from V1 during P1, and this is the point of D2/R1.** The
 * specification's §36 file list does not mention `GovernanceProfile.ts`, so
 * reading that list literally would replace the learned schema's eight flat
 * fields with sixteen groups while leaving `EditorialPolicySchema` on the old
 * eight. `resolveSemantic` would then find no counterpart for any of the new
 * dimensions, and a governance author who had set `editorial.tone` would
 * silently stop governing tone — with no error, no failed assertion, and no
 * change in coverage, because the rule that reads the resolved policy has not
 * moved. The field list and the merge rule are one contract, and a spec that
 * revises one without the other is a silent regression rather than a smaller
 * scope.
 */
export const EDITORIAL_OVERRIDE_FIELDS = SEMANTIC_DIMENSIONS;

export type EditorialOverrideField = (typeof EDITORIAL_OVERRIDE_FIELDS)[number];

/**
 * Authoring shape: every dimension partial, so an author can state one leaf.
 *
 * `partial()` is what makes "no opinion" expressible. A fully-defaulted object
 * could not distinguish "the author set formality to 50" from "the author never
 * mentioned formality", and `explicitFields` would then be carrying the entire
 * meaning of the policy on its own.
 */
export const EditorialPolicySchema = z.object({
  tone: ToneProfileSchema.partial().default({}),
  voice: VoiceProfileSchema.partial().default({}),
  formality: FormalityProfileSchema.partial().default({}),
  register: RegisterProfileSchema.partial().default({}),
  assertionStyle: AssertionStyleProfileSchema.partial().default({}),
  qualificationStyle: QualificationProfileSchema.partial().default({}),
  evidenceFraming: EvidenceFramingProfileSchema.partial().default({}),
  uncertaintyStyle: UncertaintyProfileSchema.partial().default({}),
  sentenceArchitecture: SentenceArchitectureProfileSchema.partial().default({}),
  paragraphArchitecture: ParagraphArchitectureProfileSchema.partial().default({}),
  transitions: TransitionProfileSchema.optional(),
  agency: AgencyProfileSchema.partial().default({}),
  technicality: TechnicalityProfileSchema.partial().default({}),
  rhetoricalStyle: RhetoricalStyleProfileSchema.optional(),
  conclusionStyle: ConclusionStyleProfileSchema.partial().default({}),
  lexicalPreferences: LexicalSemanticProfileSchema.partial().default({}),
  /**
   * The dimensions the author pinned on purpose.
   *
   * **Pinning is per dimension and takes the whole dimension**, not per leaf.
   * A pinned dimension is normative in full; an unpinned one is learned in full.
   * Leaf-by-leaf merging was the first design and it is unsound here: parsing a
   * partial object through a schema whose leaves have defaults returns a
   * *complete* object, so an author who set only `tone.primary` would silently
   * overwrite a learned `tone.secondary` with `[]`. Whole-dimension pinning makes
   * the rule one sentence, and it is the one an author can actually predict.
   *
   * A record written before this metadata existed parses with an empty list,
   * which is correct: nothing was pinned. `migrateV13ToV14` populates it for the
   * V1 fields that were non-default, which is the legacy rule restated.
   */
  explicitFields: z.array(z.enum(EDITORIAL_OVERRIDE_FIELDS)).default([]),
});

export type EditorialPolicy = z.infer<typeof EditorialPolicySchema>;

/**
 * Map a V1 editorial block onto V2, marking each dimension the author pinned.
 *
 * **Two mappings, not one, because V1's rule was "non-default".** Before v12
 * there was no `explicitFields`, so a stored V1 policy had no record of intent —
 * only values. `v1EditorialPins` therefore recomputes the legacy rule ("a value
 * counts as pinned when it differs from the schema default") and this maps the
 * values themselves onto the dimensions that now hold them.
 *
 * The one field that cannot be carried is the pair V2 has no dimension for
 * (`vocabularyRegister`, `readingGradeTarget`). A governance author who pinned
 * either of those governed nothing under V2, and the migration test asserts that
 * rather than leaving it to be discovered later as a policy that used to apply
 * and does not.
 */
function migrateEditorialFromV1(value: unknown): Record<string, unknown> {
  const source = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(source, key);

  const mapped: Record<string, unknown> = {};
  if (has("tone") && typeof source.tone === "string") {
    const trait = v1ToneTrait(source.tone);
    // A recognised string becomes the enum it names, because a pin takes the whole
    // dimension: an editorial `tone` of only `{ description }` would be parsed
    // through `ToneProfileSchema`, fill `primary` with its default, and overwrite
    // a learned tone the author never spoke about.
    mapped.tone = { ...(trait === null ? {} : { primary: trait }), description: source.tone };
  }
  if (has("voice") && typeof source.voice === "string") {
    const fields = v1VoiceFields(source.voice);
    // Same reason as tone: an unpinnable string leaves the enums learned.
    mapped.voice = { ...fields, description: source.voice };
  }
  if (has("formality") && typeof source.formality === "number") {
    mapped.formality = { score: Math.round(source.formality) };
  }
  if (has("preferredSentenceLength") && typeof source.preferredSentenceLength === "number") {
    mapped.sentenceArchitecture = { targetWords: source.preferredSentenceLength };
  }
  if (
    has("rhetoricalStyle") &&
    typeof source.rhetoricalStyle === "string" &&
    isV2RhetoricalStyle(source.rhetoricalStyle)
  ) {
    mapped.rhetoricalStyle = source.rhetoricalStyle;
  }
  if (has("avoidWords") && Array.isArray(source.avoidWords)) {
    mapped.lexicalPreferences = { toneAvoid: source.avoidWords };
  }

  mapped.explicitFields = migratedEditorialPins(source);
  return mapped;
}

/**
 * The pins a stored V1 editorial block yields.
 *
 * Two witnesses are combined rather than one chosen between. `v1EditorialPins`
 * applies the legacy "non-default" rule to the values, which is how a block with no
 * `explicitFields` states its intent; a stored list states intent directly, but its
 * entries may be V1 *field* names (`preferredSentenceLength`), which are not V2
 * dimensions and would fail the enum outright. Stored entries are therefore mapped
 * through `V1_EDITORIAL_FIELD_DIMENSIONS` — a name already valid in V2 passes
 * through — and unioned with the computed set, so a V13 block that recorded one pin
 * and also held another non-default value does not lose the second.
 */
function migratedEditorialPins(source: Record<string, unknown>): string[] {
  const stored = Array.isArray(source.explicitFields)
    ? source.explicitFields
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) =>
          (SEMANTIC_DIMENSIONS as readonly string[]).includes(entry)
            ? entry
            : V1_EDITORIAL_FIELD_DIMENSIONS.get(entry),
        )
        .filter((entry): entry is string => typeof entry === "string")
    : [];
  const pins = [...new Set([...stored, ...v1EditorialPins(source)])];
  /*
   * Two of those are then removed.
   *
   * For `tone` and `voice` the legacy rule is one step too eager: a V1 free string
   * that names no V2 enum (`"formal"`, `"conversational"`) leaves nothing normative
   * behind, so pinning it would override the learned dimension with schema
   * defaults. The V1 value stays visible as `description`, and nothing it could not
   * express governs.
   */
  if (typeof source.tone === "string" && v1ToneTrait(source.tone) === null) {
    return pins.filter((pin) => pin !== "tone");
  }
  if (typeof source.voice === "string" && Object.keys(v1VoiceFields(source.voice)).length === 0) {
    return pins.filter((pin) => pin !== "voice");
  }
  return pins;
}

/** A V1 tone string that names a V2 tone trait, or null when it names none. */
function v1ToneTrait(value: string): z.infer<typeof ToneTraitSchema> | null {
  const parsed = ToneTraitSchema.safeParse(value.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}

/**
 * The V2 voice leaves a V1 voice string names.
 *
 * V1 voice was one free string covering person *and* construction, so a value that
 * names either is mapped onto that leaf alone and the other stays learned. Keyed
 * by a normalised form because V1 wrote `"third person"` as readily as
 * `"third-person"`.
 */
const V1_VOICE_FIELDS: ReadonlyMap<string, Readonly<Record<string, string>>> = new Map([
  ["first", { person: "first" }],
  ["firstperson", { person: "first" }],
  ["firstpersonplural", { person: "first" }],
  ["we", { person: "first" }],
  ["third", { person: "third" }],
  ["thirdperson", { person: "third" }],
  ["he", { person: "third" }],
  ["she", { person: "third" }],
  ["they", { person: "third" }],
  ["mixed", { person: "mixed" }],
  ["impersonal", { person: "impersonal" }],
  ["active", { construction: "active" }],
  ["passive", { construction: "passive" }],
  ["balanced", { construction: "balanced" }],
]);

function v1VoiceFields(value: string): Record<string, string> {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return { ...(V1_VOICE_FIELDS.get(key) ?? {}) };
}

/**
 * A V2 rhetorical style value, as a runtime guard.
 *
 * V1 accepted any string here. A stored `"flowery"` must not become a pin on a
 * dimension it cannot express, so the mapping drops the value rather than
 * guessing which V2 trait was meant.
 */
function isV2RhetoricalStyle(value: string): boolean {
  return RHETORICAL_STYLE_VALUES.has(value);
}

/**
 * The field as read from a store: a V1 editorial block is mapped forward, and
 * `explicitFields` is populated from the legacy "non-default" rule when the stored
 * block predates v12 and therefore carries none.
 *
 * Same reasoning as `StoredSemanticStyleSchema`, and the same hazard avoided: a
 * v13 governance profile with `editorial: { tone: "formal" }` read through the
 * V2 schema alone would parse to an all-default policy with no pins, and
 * `resolveSemantic` would then report the profile as governing nothing — a policy
 * that silently stopped applying, with no error anywhere.
 */
export const StoredEditorialPolicySchema = z.preprocess((value) => {
  const source = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  /*
   * The absence of `explicitFields` is the primary witness, and it is exact.
   *
   * The field was introduced in v12, so a block that carries it was authored
   * against V2 and needs no mapping. The value-type witnesses below are
   * fallbacks for the genuinely ambiguous case: a V1 block whose only pinned
   * field is `rhetoricalStyle`, where "forensic" is a valid value in *both*
   * schemas and no shape test can tell them apart. Without the `explicitFields`
   * test that block would parse unmapped with an empty pin list — a policy that
   * used to govern rhetorical style and silently stops, which is the D2/R1
   * regression in its most literal form.
   */
  const isV1 =
    !Array.isArray(source.explicitFields) ||
    typeof source.tone === "string" ||
    typeof source.voice === "string" ||
    typeof source.formality === "number" ||
    typeof source.preferredSentenceLength === "number" ||
    typeof source.readingGradeTarget === "number" ||
    typeof source.vocabularyRegister === "string" ||
    Array.isArray(source.avoidWords);
  if (!isV1) return value;
  return {
    ...migrateEditorialFromV1(source),
    explicitFields: migratedEditorialPins(source),
  };
}, EditorialPolicySchema);
export type StoredEditorialPolicy = z.output<typeof StoredEditorialPolicySchema>;

/** Mark editorial fields as explicitly set so a default value stays authoritative. */
export function withExplicitEditorialFields(
  editorial: Partial<EditorialPolicy>,
  fields: readonly EditorialOverrideField[],
): EditorialPolicy {
  return EditorialPolicySchema.parse({ ...editorial, explicitFields: [...fields] });
}

/**
 * The finding categories a rule can bind to.
 *
 * A rule with no `source` matched nothing at plan time: the planner had no way
 * to know which finding a rule referred to, so `autoFix` and `severity` were
 * fields nobody read. Binding a rule to a category is what makes the normative
 * half of the policy contract reachable.
 *
 * Kept as a closed list rather than a free string so a typo cannot silently
 * produce a rule that never fires.
 */
export const GOVERNANCE_RULE_SOURCES = [
  "typography",
  "houseStyle.terminology",
  "formatting",
  "semantic",
  "protection",
] as const;

export const GovernanceRuleSchema = z.object({
  id: z.string().uuid(),
  description: z.string().trim().min(1),
  scope: z.enum(["typography", "houseStyle", "formatting", "semantic", "protection"]),
  /**
   * The finding category this rule governs. Required rather than optional: an
   * unbound rule cannot affect anything, and a rule the author cannot see take
   * effect is the same defect as a toggle that changes nothing.
   */
  source: z.enum(GOVERNANCE_RULE_SOURCES),
  severity: z.enum(["mandatory", "advisory", "informational"]),
  autoFix: z.boolean().default(false),
  protectedBehavior: z.enum(["skip", "flag", "block"]).default("flag"),
  remediation: z.string().trim().default(""),
});

/** Find the rule governing a finding category, or null when none does. */
export function ruleForSource(
  rules: readonly GovernanceRule[],
  source: string,
): GovernanceRule | null {
  return rules.find((rule) => rule.source === source) ?? null;
}

/**
 * The policy scope a rule's source belongs to.
 *
 * `source` is the fine-grained finding category and `scope` is the coarse
 * policy area, so the two are not the same string. Deriving the coarse one here
 * rather than in the editor means a new source cannot be added without also
 * saying which area it governs.
 */
export function scopeForSource(source: GovernanceRule["source"]): GovernanceRule["scope"] {
  if (source.startsWith("houseStyle.")) return "houseStyle";
  if (source === "typography") return "typography";
  if (source === "formatting") return "formatting";
  if (source === "semantic") return "semantic";
  return "protection";
}

export type GovernanceRule = z.infer<typeof GovernanceRuleSchema>;

export const GovernanceProfileSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative().default(1),
  style: StyleProfileSchema,
  rules: z.array(GovernanceRuleSchema).default([]),
  /*
   * No `terminology`. Governance governs protection and editability; house wording
   * is a deterministic-review standard and is authored on the profile itself. See
   * the note where `TerminologyPolicySchema` used to be declared.
   *
   * A stored record carrying the key still parses - Zod strips unknown keys - so no
   * migration is needed, and nothing is lost that a rule was reading, because no
   * rule was.
   */
  scope: ScopePolicySchema.default({}),
  protection: ProtectionPolicySchema.default({}),
  editorial: StoredEditorialPolicySchema.default({}),
  provenance: z.object({
    createdAt: z.string().datetime(),
    createdBy: z.string().trim().min(1),
    sourceTemplateId: z.string().uuid().optional(),
    lineage: z.array(z.string().uuid()).default([]),
  }),
});

export type GovernanceProfile = z.infer<typeof GovernanceProfileSchema>;

/** Create a new governance profile wrapping the given StyleProfile. */
export function createGovernanceProfile(
  style: StyleProfile,
  createdBy: string = "system",
): GovernanceProfile {
  const now = new Date().toISOString();
  return GovernanceProfileSchema.parse({
    id: uuidv4(),
    version: 1,
    style,
    rules: [],
    terminology: {},
    scope: {},
    protection: {},
    editorial: {},
    provenance: {
      createdAt: now,
      createdBy,
      lineage: [],
    },
  });
}
