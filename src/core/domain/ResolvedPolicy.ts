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
  SemanticProfileSchema,
  StyleProfileSchema,
  TypographyRulesSchema,
  type HouseStyle,
  type LanguageConventionProfile,
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
   */
  const governed = TerminologyRuleSchema.array().parse(
    unique(Object.keys(terminology.preferredTerms)).map((source) => ({
      id: `governance:${source}`,
      source,
      replacement: terminology.preferredTerms[source],
    })),
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
