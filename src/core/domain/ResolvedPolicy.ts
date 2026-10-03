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

/**
 * The house-style section, parsed.
 *
 * Parsing rather than passing through is the point: it is what applies the schema
 * defaults, so a record written before a field existed reaches a rule as a complete
 * object. The governance merge that used to happen here is gone - wording is
 * authored on the profile, and a second place to write it was the ambiguity the
 * audit's §3 describes.
 */
function resolveHouseStyle(learned: StyleProfile["houseStyle"]): HouseStyle {
  return HouseStyleSchema.parse(learned);
}

/**
 * The language conventions, parsed.
 *
 * Parsed rather than hand-built for the same reason as `resolveHouseStyle`: the
 * schema supplies `caseSensitive`, `wholeWord`, `severity`, `scope` and the rest,
 * and a literal would have to restate every default to satisfy the type — which is
 * exactly where a default can drift from the schema without a test noticing.
 *
 * The governance merge this used to perform is gone. Wording is authored on the
 * profile alone, so there is one place to state a house term and no question about
 * which record is in force when the two disagreed.
 */
function resolveLanguage(learned: LanguageConventionProfile): LanguageConventionProfile {
  return LanguageConventionProfileSchema.parse(learned);
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
    /*
     * Governance no longer supplies wording.
     *
     * Both resolvers used to merge `governance.terminology` into the profile's
     * sections, which meant two places to author one rule and no way to tell which
     * was in force. The terminology policy has been removed from the governance
     * profile (governance governs protection and editability; the profile owns
     * wording), so the profile's own sections are now the whole answer.
     *
     * The resolvers are kept rather than inlined because each still does something:
     * `resolveHouseStyle` parses, which is what applies the schema defaults, and
     * `resolveLanguage` will gain the same treatment when the migrated terminology
     * rules are wired.
     */
    houseStyle: resolveHouseStyle(profile.houseStyle),
    language: resolveLanguage(profile.language),
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
