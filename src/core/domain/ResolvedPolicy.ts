import { z } from "zod";
import {
  EditorialPolicySchema,
  GovernanceProfileSchema,
  GovernanceRuleSchema,
  ProtectionPolicySchema,
  ScopePolicySchema,
  type EditorialPolicy,
  type GovernanceProfile,
} from "./GovernanceProfile";
import {
  DocumentFormattingProfileSchema,
  DocumentStructureProfileSchema,
  HouseStyleSchema,
  LanguageConventionProfileSchema,
  TerminologyRuleSchema,
  StyleProfileSchema,
  TypographyRulesSchema,
  type HouseStyle,
  type LanguageConventionProfile,
  type StyleProfile,
} from "./StyleProfile";
import {
  SEMANTIC_DIMENSIONS,
  SemanticStyleProfileSchema,
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
  type SemanticStyleProfile,
} from "./SemanticStyleProfile";
import { type EditorialOverrideField } from "./GovernanceProfile";

/**
 * The immutable policy consumed by analysis and planning.
 *
 * StyleProfile owns learned/evidence-backed characteristics. GovernanceProfile
 * owns normative scope, protection, terminology, editorial, and rule policy.
 * Consumers receive this resolved contract rather than interpreting the two
 * records independently.
 */
export const ResolvedPolicySchema = z.object({
  schemaVersion: z.literal(1),
  profile: StyleProfileSchema,
  governance: GovernanceProfileSchema,
  typography: TypographyRulesSchema,
  houseStyle: HouseStyleSchema,
  /*
   * The three sections spec section 6 adds. They are resolved rather than read
   * off the profile so that a rule never has to decide for itself whether
   * governance overrode the learned value — a rule reading `profile.language`
   * directly would silently ignore a governance author who set a preferred term,
   * and the rule would look correctly wired in the registry audit while
   * enforcing the wrong thing.
   */
  language: LanguageConventionProfileSchema,
  formatting: DocumentFormattingProfileSchema,
  structure: DocumentStructureProfileSchema,
  semantic: SemanticStyleProfileSchema,
  scope: ScopePolicySchema,
  protection: ProtectionPolicySchema,
  editorial: EditorialPolicySchema,
  rules: z.array(GovernanceRuleSchema),
  provenance: z.object({
    profileId: z.string().uuid(),
    profileRevision: z.number().int().nonnegative(),
    profileUpdatedAt: z.string().datetime(),
    governanceId: z.string().uuid(),
    governanceVersion: z.number().int().nonnegative(),
    governanceCreatedAt: z.string().datetime(),
  }),
});

export type ResolvedPolicy = z.infer<typeof ResolvedPolicySchema>;

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function resolveHouseStyle(
  learned: StyleProfile["houseStyle"],
  terminology: GovernanceProfile["terminology"],
): HouseStyle {
  return HouseStyleSchema.parse({
    ...learned,
    preferredTerminology: {
      ...learned.preferredTerminology,
      ...terminology.preferredTerms,
    },
    bannedTerms: unique([...learned.bannedTerms, ...terminology.bannedTerms]),
  });
}

/**
 * Merge governance's terminology into the language conventions.
 *
 * Governance is a `record` of preferred terms and a list of banned ones, while
 * the profile's `terminology` is a list of rules with ids, severities and
 * matching options. The two have to meet, so a governance term becomes a rule
 * with a derived id and otherwise default behaviour.
 *
 * The profile's own rules come first and a governance term with the same
 * `from` replaces them rather than joining them: a governance author overriding
 * a learned rule means the normative value, not the measured one, and two rules
 * for the same word would report the same deviation twice with different
 * severities.
 */
function resolveLanguage(
  learned: LanguageConventionProfile,
  terminology: GovernanceProfile["terminology"],
): LanguageConventionProfile {
  /*
   * Parsed rather than hand-built. The schema supplies `caseSensitive`,
   * `wholeWord`, `severity` and `scope`, and a literal would have to restate
   * those defaults to satisfy the type — which is exactly the place a default
   * can drift from the schema without a test noticing.
   *
   * Built from the *entries*, not from the keys. `unique(Object.keys(...))`
   * trimmed each key and then looked the replacement up with the trimmed key,
   * so a governance author who wrote `" color "` produced a rule whose
   * `replacement` was `undefined` — and an absent replacement is how a
   * terminology rule says "banned term", so the rule would have deleted the
   * word instead of rewriting it. Trimming each side and skipping an entry
   * whose trimmed source or replacement is empty keeps a whitespace-padded
   * record behaving like the clean one it was meant to be.
   */
  const governed = TerminologyRuleSchema.array().parse(
    Object.entries(terminology.preferredTerms).flatMap(([source, replacement]) => {
      const trimmedSource = source.trim();
      const trimmedReplacement = replacement.trim();
      if (trimmedSource.length === 0 || trimmedReplacement.length === 0) return [];
      return [
        {
          id: `governance:${trimmedSource}`,
          source: trimmedSource,
          replacement: trimmedReplacement,
        },
      ];
    }),
  );
  const governedSources = new Set(governed.map((rule) => rule.source));
  return LanguageConventionProfileSchema.parse({
    ...learned,
    terminology: [
      ...learned.terminology.filter((rule) => !governedSources.has(rule.source)),
      ...governed,
    ],
    bannedTerms: unique([...learned.bannedTerms, ...terminology.bannedTerms]),
  });
}

/**
 * The full schema for one dimension, keyed by name.
 *
 * A map rather than sixteen hand-written branches so that adding a dimension to
 * `SEMANTIC_DIMENSIONS` cannot leave this function silently unaware of it: the
 * type is derived from the list, so a new dimension is a compile error here until
 * it is given a schema.
 */
const DIMENSION_SCHEMAS = {
  tone: ToneProfileSchema,
  voice: VoiceProfileSchema,
  formality: FormalityProfileSchema,
  register: RegisterProfileSchema,
  assertionStyle: AssertionStyleProfileSchema,
  qualificationStyle: QualificationProfileSchema,
  evidenceFraming: EvidenceFramingProfileSchema,
  uncertaintyStyle: UncertaintyProfileSchema,
  sentenceArchitecture: SentenceArchitectureProfileSchema,
  paragraphArchitecture: ParagraphArchitectureProfileSchema,
  transitions: TransitionProfileSchema,
  agency: AgencyProfileSchema,
  technicality: TechnicalityProfileSchema,
  rhetoricalStyle: RhetoricalStyleProfileSchema,
  conclusionStyle: ConclusionStyleProfileSchema,
  lexicalPreferences: LexicalSemanticProfileSchema,
} as const satisfies Record<EditorialOverrideField, z.ZodTypeAny>;

/**
 * Merge learned evidence with the governance author's editorial pins.
 *
 * **Pinning is per dimension and takes the whole dimension.** A dimension named
 * in `explicitFields` is parsed through its full schema — which fills any leaf the
 * author left out with that leaf's default — and replaces the learned dimension
 * outright. A dimension not named is learned, in full.
 *
 * The alternative, a per-leaf merge, is unsound: `EditorialPolicySchema` stores
 * partial objects, and parsing a partial through a schema whose leaves have
 * defaults returns a complete object. An author who set only `tone.primary`
 * would therefore overwrite a learned `tone.secondary` with `[]` without ever
 * having expressed an opinion about it. Whole-dimension pinning makes the rule one
 * sentence and makes it predictable, which is the only property an override needs.
 *
 * The V1 rule this replaces was "a normative value wins when the author set it, or
 * when it differs from the default". `migrateV13ToV14` reproduces it by putting
 * every non-default V1 field into `explicitFields`, so a migrated policy governs
 * exactly what it used to govern.
 */
function resolveSemantic(
  learned: SemanticStyleProfile,
  editorial: EditorialPolicy,
): SemanticStyleProfile {
  const pinned = new Set<string>(editorial.explicitFields);
  const merged: Record<string, unknown> = { ...learned };

  SEMANTIC_DIMENSIONS.forEach((dimension) => {
    if (!pinned.has(dimension)) return;
    const authoritative = editorial[dimension];
    if (authoritative === undefined) return;
    const schema = DIMENSION_SCHEMAS[dimension] as z.ZodTypeAny;
    merged[dimension] = schema.parse(authoritative);
  });

  // `legacyV1` is the migration's record of what could not be mapped, not a
  // style value. A pin never invents one and never carries a learned one forward,
  // so it is copied through untouched rather than merged.
  return SemanticStyleProfileSchema.parse({
    ...merged,
    schemaVersion: learned.schemaVersion,
    ...(learned.legacyV1 === undefined ? {} : { legacyV1: learned.legacyV1 }),
  });
}

/** Resolve learned style and normative governance into one policy snapshot. */
export function resolveResolvedPolicy(
  profileInput: StyleProfile,
  governanceInput: GovernanceProfile,
): ResolvedPolicy {
  const profile = StyleProfileSchema.parse(profileInput);
  const governance = GovernanceProfileSchema.parse(governanceInput);
  const revision = profile.revision;

  return ResolvedPolicySchema.parse({
    schemaVersion: 1,
    profile,
    governance,
    typography: profile.typography,
    houseStyle: resolveHouseStyle(profile.houseStyle, governance.terminology),
    language: resolveLanguage(profile.language, governance.terminology),
    formatting: profile.formatting,
    structure: profile.structure,
    semantic: resolveSemantic(profile.semantic, governance.editorial),
    scope: governance.scope,
    protection: governance.protection,
    editorial: governance.editorial,
    rules: governance.rules,
    provenance: {
      profileId: profile.id,
      profileRevision: revision,
      profileUpdatedAt: profile.updatedAt,
      governanceId: governance.id,
      governanceVersion: governance.version,
      governanceCreatedAt: governance.provenance.createdAt,
    },
  });
}
