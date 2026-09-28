/**
 * Unified Finding model used by the deterministic, semantic, formatting, and
 * cross-report consistency engines. Rules/UI never mutate Word directly —
 * findings feed ChangePlan.
 */

import { z } from "zod";
import { ChangePreconditionSchema } from "./Change";

/**
 * `consistency` is its own kind rather than a flavour of `semantic`.
 *
 * The difference is not cosmetic. Consistency findings come from the one engine
 * that is non-deterministic by design (ADR-0052), so a user reviewing a plan
 * must be able to tell at a glance which findings came from a comparison that
 * could be wrong. Folding them into `semantic` would hide exactly the property
 * that matters most about them.
 */
export const FindingKindSchema = z.enum(["deterministic", "semantic", "formatting", "consistency"]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const SeveritySchema = z.enum(["info", "warning", "error"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const RangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    unit: z.enum(["character", "paragraph", "section"]).default("character"),
  })
  .refine((r) => r.start <= r.end, {
    message: "Range.start must be <= Range.end",
    path: ["start"],
  });

export type Range = z.infer<typeof RangeSchema>;

export const FindingSourceSchema = z.enum(["deterministic", "ai", "profile", "user"]);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

export const FindingRiskSchema = z.enum(["none", "low", "medium", "high"]);
export type FindingRisk = z.infer<typeof FindingRiskSchema>;

export const FindingStatusSchema = z.enum(["new", "reviewed", "accepted", "ignored", "deferred"]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FindingTransformationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("case"),
    style: z.enum(["sentence", "title"]),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("replace"),
    text: z.string(),
  }),
]);

export const FindingSchema = z.object({
  id: z.string().uuid(),
  kind: FindingKindSchema,
  category: z.string().trim().min(1),
  range: RangeSchema,
  message: z.string().trim().min(1),
  severity: SeveritySchema,
  evidence: z.string().trim().default(""),
  suggestedChangeId: z.string().optional(),
  ruleId: z.string().trim().min(1).optional(),
  confidence: z.number().min(0).max(1).default(1),
  /** False when a finding is informational only and cannot produce a change. */
  actionable: z.boolean().optional(),
  advisoryReason: z.string().trim().min(1).optional(),
  // --- additive fields (Phase A) ---
  nodeIds: z.array(z.string().trim().min(1)).default([]),
  source: FindingSourceSchema.default("deterministic"),
  risk: FindingRiskSchema.default("none"),
  reversible: z.boolean().default(true),
  status: FindingStatusSchema.default("new"),
  actual: z.string().optional(),
  expected: z.string().optional(),
  explanation: z.string().optional(),
  transformation: FindingTransformationSchema.optional(),
  precondition: ChangePreconditionSchema.optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

/**
 * A finding the user chose to ignore, stored by fingerprint.
 *
 * The fingerprint is the identity of the *problem*, not of one detection run:
 * `findingFingerprint` deliberately excludes the generated uuid and the absolute
 * character offset, so an ignore survives a rescan and survives text shifting
 * above it. Keying by `finding.id` instead would expire every ignore at the next
 * scan, and the ignore list would read as broken.
 *
 * The subset of fields stored is what the ignored list needs to render and to
 * offer "Go to text" and "Restore". Nothing capable of holding document text is
 * included beyond what the user already saw on the card.
 */
export const IgnoredFindingSchema = z.object({
  fingerprint: z.string().trim().min(1),
  findingId: z.string().uuid(),
  category: z.string().trim().min(1),
  message: z.string().trim().min(1),
  range: RangeSchema,
  nodeIds: z.array(z.string().trim().min(1)).default([]),
  ignoredAt: z.string().datetime(),
  /**
   * The occurrence this ignore covers.
   *
   * Stored alongside the fingerprint rather than replacing it. The fingerprint is
   * the identity of the *rule* and is what makes the list readable; the occurrence
   * key is what makes two hits of the same rule separately ignorable. Keeping
   * both is what lets Restore address one row instead of every row of that rule.
   *
   * Optional and unconstrained rather than `min(1).default("")`: a row written
   * before the key existed parses as an empty string, and a key that is absent
   * is a different fact from a key that is malformed. A minimum length would
   * reject the old rows outright and take the user's ignores with them.
   */
  occurrenceKey: z.string().trim().default(""),
});
export type IgnoredFinding = z.infer<typeof IgnoredFindingSchema>;

/**
 * A finding the user reviewed, stored as a decision rather than as a status.
 *
 * **Why it is a separate record and not `Finding.status = "reviewed"`.** The
 * status field is written by the observer, which knows nothing about what the
 * user did, so the pane had to patch the observer's data back after every scan.
 * Worse, the review has to survive a *different run*: the observer's scan and the
 * preview that builds the plan are separate passes that issue separate uuids, so
 * a review recorded against the id the user clicked could never be recognised in
 * the plan Apply actually writes. Storing the decision under an occurrence
 * identity — rather than under an id or a bare rule fingerprint — is what makes
 * the two passes agree.
 *
 * `changeId` records the change the review resolved to, when one exists. A review
 * with no eligible change is still a real decision ("I have seen this, it needs
 * no correction"), so it is kept and reported rather than discarded.
 */
export const ReviewedFindingSchema = z.object({
  /** `reviewIdentity` of the finding the user reviewed. Exact by design. */
  identity: z.string().trim().min(1),
  findingId: z.string().uuid(),
  category: z.string().trim().min(1),
  range: RangeSchema,
  nodeIds: z.array(z.string().trim().min(1)).default([]),
  reviewedAt: z.string().datetime(),
  /**
   * The plan change this review admitted, or null when the finding produced none.
   *
   * Null is a real outcome, not a missing value: most findings are advisory and
   * the planner has no correction for them. Recording that explicitly is what
   * lets the pane say "reviewed, and there is nothing to apply" instead of
   * treating the finding as unreviewed and asking again.
   */
  changeId: z.string().uuid().nullable().default(null),
  /** Why no change was admitted, when none was. The engine's own words. */
  noChangeReason: z.string().trim().min(1).nullable().default(null),
});
export type ReviewedFinding = z.infer<typeof ReviewedFindingSchema>;
