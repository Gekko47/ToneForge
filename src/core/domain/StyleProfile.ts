/**
 * Canonical StyleProfile domain model.
 *
 * This single object drives BOTH the Reformat and Consistency Check engines
 * (Roadmap "One canonical profile" rule). It is user-editable, versioned, and
 * split into measured (deterministic) and semantic (AI) sections.
 *
 * Boundary rule: core/domain must not import from `word`, `ai`, or `ui`.
 */

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

export const ProfileVersionSchema = z.object({
  major: z.number().int().nonnegative(),
  minor: z.number().int().nonnegative(),
  patch: z.number().int().nonnegative(),
});

export type ProfileVersion = z.infer<typeof ProfileVersionSchema>;

export const TypographyRulesSchema = z.object({
  // How an em dash is represented. "em" is the Unicode U+2014 character,
  // "hyphen" is a double hyphen "--", and "space" is a plain space. The
  // companion `emDashSpacing` field controls whether the dash is surrounded
  // by spaces, which is orthogonal to how the dash itself is encoded.
  emDash: z.enum(["em", "hyphen", "space"]).default("em"),
  emDashSpacing: z.enum(["spaced", "tight"]).default("spaced"),
  enDashSpacing: z.enum(["spaced", "tight"]).default("spaced"),
  doubleQuotes: z.enum(["curly", "straight"]).default("curly"),
  singleQuotes: z.enum(["curly", "straight"]).default("curly"),
  apostrophes: z.enum(["curly", "straight"]).default("curly"),
  decimalSeparator: z.enum(["dot", "comma"]).default("dot"),
  thousandsSeparator: z.enum(["none", "space", "comma"]).default("none"),
  ellipsis: z.enum(["ellipsis", "three-dots", "spaced-dots"]).default("ellipsis"),
});

export type TypographyRules = z.infer<typeof TypographyRulesSchema>;

export const HouseStyleSchema = z.object({
  preferredTerminology: z.record(z.string(), z.string()).default({}),
  bannedTerms: z.array(z.string()).default([]),
  capitalization: z
    .object({
      sentenceCase: z.boolean().default(true),
      titleCaseWords: z.array(z.string()).default([]),
    })
    .default({}),
  spellingVariant: z.enum(["en-US", "en-GB", "au"]).default("en-US"),
});

export type HouseStyle = z.infer<typeof HouseStyleSchema>;

export const SemanticProfileSchema = z.object({
  tone: z.string().trim().min(1).default("neutral"),
  voice: z.string().trim().min(1).default("third-person"),
  formality: z.number().min(0).max(100).default(50),
  readingGradeTarget: z.number().min(0).max(20).nullable().default(null),
  preferredSentenceLength: z.number().min(5).max(60).default(22),
  vocabularyRegister: z.enum(["simple", "standard", "technical", "academic"]).default("standard"),
  rhetoricalStyle: z.string().trim().min(1).default("direct"),
  avoidWords: z.array(z.string()).default([]),
});

export type SemanticProfile = z.infer<typeof SemanticProfileSchema>;

export const MeasuredProfileSchema = z.object({
  avgSentenceLength: z.number().nullable().default(null),
  sentenceLengthStdDev: z.number().nullable().default(null),
  emDashFrequency: z.number().nullable().default(null),
  enDashFrequency: z.number().nullable().default(null),
  curlyQuoteFrequency: z.number().nullable().default(null),
  paragraphLengthAvg: z.number().nullable().default(null),
  capitalizationConsistency: z.number().nullable().default(null),
  sampleWordCount: z.number().nullable().default(null),
});

export type MeasuredProfile = z.infer<typeof MeasuredProfileSchema>;

export const StyleProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
  version: ProfileVersionSchema,
  measured: MeasuredProfileSchema,
  semantic: SemanticProfileSchema,
  typography: TypographyRulesSchema,
  houseStyle: HouseStyleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  sourceSampleIds: z.array(z.string().uuid()).default([]),
});

export type StyleProfile = z.infer<typeof StyleProfileSchema>;

/** Create a new empty profile with the given version. */
export function createEmptyProfile(
  name: string,
  version: ProfileVersion = { major: 1, minor: 0, patch: 0 },
): StyleProfile {
  const now = new Date().toISOString();
  return StyleProfileSchema.parse({
    id: uuidv4(),
    name,
    version,
    measured: {},
    semantic: {},
    typography: {},
    houseStyle: {},
    createdAt: now,
    updatedAt: now,
    sourceSampleIds: [],
  });
}
