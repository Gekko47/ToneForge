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
    profileVersion: z.string().trim().min(1),
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

  // Existing governance records were created before editorial overrides were
  // distinguished from defaults. Only non-default normative values override
  // learned evidence until an explicit lifecycle field is introduced later.
  const value = <T>(normative: T, learnedValue: T, defaultValue: T): T =>
    Object.is(normative, defaultValue) ? learnedValue : normative;

  return SemanticProfileSchema.parse({
    tone: value(editorial.tone, learned.tone, defaults.tone),
    voice: value(editorial.voice, learned.voice, defaults.voice),
    formality: value(editorial.formality, learned.formality, defaults.formality),
    readingGradeTarget: value(
      editorial.readingGradeTarget,
      learned.readingGradeTarget,
      defaults.readingGradeTarget,
    ),
    preferredSentenceLength: value(
      editorial.preferredSentenceLength,
      learned.preferredSentenceLength,
      defaults.preferredSentenceLength,
    ),
    vocabularyRegister: value(
      editorial.vocabularyRegister,
      learned.vocabularyRegister,
      defaults.vocabularyRegister,
    ),
    rhetoricalStyle: value(
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
  const version = `${profile.version.major}.${profile.version.minor}.${profile.version.patch}`;

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
      profileVersion: version,
      profileUpdatedAt: profile.updatedAt,
      governanceId: governance.id,
      governanceVersion: governance.version,
      governanceCreatedAt: governance.provenance.createdAt,
    },
  });
}
