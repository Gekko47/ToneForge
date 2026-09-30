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
