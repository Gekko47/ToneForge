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
  HouseStyleSchema,
  SemanticProfileSchema,
  StyleProfileSchema,
  TypographyRulesSchema,
  type HouseStyle,
  type SemanticProfile,
  type StyleProfile,
} from "./StyleProfile";

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
  semantic: SemanticProfileSchema,
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

function resolveSemantic(learned: SemanticProfile, editorial: EditorialPolicy): SemanticProfile {
  const defaults = EditorialPolicySchema.parse({});
  const explicit = new Set<string>(editorial.explicitFields);

  // A normative value wins when the governance author set it, or when it differs
  // from the schema default. Records written before explicit-set metadata
  // existed carry an empty list, so only their non-default values override
  // learned evidence.
  const value = <T>(field: string, normative: T, learnedValue: T, defaultValue: T): T =>
    explicit.has(field) || !Object.is(normative, defaultValue) ? normative : learnedValue;

  return SemanticProfileSchema.parse({
    tone: value("tone", editorial.tone, learned.tone, defaults.tone),
    voice: value("voice", editorial.voice, learned.voice, defaults.voice),
    formality: value("formality", editorial.formality, learned.formality, defaults.formality),
    readingGradeTarget: value(
      "readingGradeTarget",
      editorial.readingGradeTarget,
      learned.readingGradeTarget,
      defaults.readingGradeTarget,
    ),
    preferredSentenceLength: value(
      "preferredSentenceLength",
      editorial.preferredSentenceLength,
      learned.preferredSentenceLength,
      defaults.preferredSentenceLength,
    ),
    vocabularyRegister: value(
      "vocabularyRegister",
      editorial.vocabularyRegister,
      learned.vocabularyRegister,
      defaults.vocabularyRegister,
    ),
    rhetoricalStyle: value(
      "rhetoricalStyle",
      editorial.rhetoricalStyle,
      learned.rhetoricalStyle,
      defaults.rhetoricalStyle,
    ),
    avoidWords: unique([...learned.avoidWords, ...editorial.avoidWords]),
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
