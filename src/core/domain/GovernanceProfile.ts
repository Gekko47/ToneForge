/**
 * GovernanceProfile — policy envelope wrapping StyleProfile plus
 * rule sets, terminology, scope, protection, editorial, and provenance.
 *
 * Boundary rule: core/domain must not import from `word`, `ai`, or `ui`.
 */

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { StyleProfileSchema, type StyleProfile } from "./StyleProfile";

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
  includeLists: z.boolean().default(true),
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
  userLockedRanges: z.array(z.string().uuid()).default([]),
});

export type ProtectionPolicy = z.infer<typeof ProtectionPolicySchema>;

export const TerminologyPolicySchema = z.object({
  preferredTerms: z.record(z.string(), z.string()).default({}),
  bannedTerms: z.array(z.string()).default([]),
  requiredTerms: z.array(z.string()).default([]),
  locale: z.string().default("en-US"),
});

export type TerminologyPolicy = z.infer<typeof TerminologyPolicySchema>;

/** Editorial fields a governance author can pin explicitly. */
export const EDITORIAL_OVERRIDE_FIELDS = [
  "tone",
  "voice",
  "formality",
  "readingGradeTarget",
  "preferredSentenceLength",
  "vocabularyRegister",
  "rhetoricalStyle",
] as const;

export type EditorialOverrideField = (typeof EDITORIAL_OVERRIDE_FIELDS)[number];

export const EditorialPolicySchema = z.object({
  tone: z.string().trim().min(1).default("neutral"),
  voice: z.string().trim().min(1).default("third-person"),
  formality: z.number().min(0).max(100).default(50),
  readingGradeTarget: z.number().min(0).max(20).nullable().default(null),
  preferredSentenceLength: z.number().min(5).max(60).default(22),
  vocabularyRegister: z.enum(["simple", "standard", "technical", "academic"]).default("standard"),
  rhetoricalStyle: z.string().trim().min(1).default("direct"),
  avoidWords: z.array(z.string()).default([]),
  /**
   * Fields the governance author set on purpose. A pinned field stays
   * authoritative even when its value equals the schema default, which is
   * otherwise indistinguishable from an unset field. Records written before
   * this metadata existed parse with an empty list and keep the legacy rule
   * where only non-default values override learned evidence.
   */
  explicitFields: z.array(z.enum(EDITORIAL_OVERRIDE_FIELDS)).default([]),
});

export type EditorialPolicy = z.infer<typeof EditorialPolicySchema>;

/** Mark editorial fields as explicitly set so a default value stays authoritative. */
export function withExplicitEditorialFields(
  editorial: Partial<EditorialPolicy>,
  fields: readonly EditorialOverrideField[],
): EditorialPolicy {
  return EditorialPolicySchema.parse({ ...editorial, explicitFields: [...fields] });
}

export const GovernanceRuleSchema = z.object({
  id: z.string().uuid(),
  description: z.string().trim().min(1),
  scope: z.enum(["typography", "houseStyle", "formatting", "semantic", "protection"]),
  severity: z.enum(["mandatory", "advisory", "informational"]),
  autoFix: z.boolean().default(false),
  protectedBehavior: z.enum(["skip", "flag", "block"]).default("flag"),
  remediation: z.string().trim().default(""),
});

export type GovernanceRule = z.infer<typeof GovernanceRuleSchema>;

export const GovernanceProfileSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative().default(1),
  style: StyleProfileSchema,
  rules: z.array(GovernanceRuleSchema).default([]),
  terminology: TerminologyPolicySchema.default({}),
  scope: ScopePolicySchema.default({}),
  protection: ProtectionPolicySchema.default({}),
  editorial: EditorialPolicySchema.default({}),
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
