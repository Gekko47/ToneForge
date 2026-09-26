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
