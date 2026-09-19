/**
 * Unified Finding model used by BOTH deterministic and semantic engines.
 * Rules/UI never mutate Word directly — findings feed ChangePlan.
 */

import { z } from "zod";

export const FindingKindSchema = z.enum(["deterministic", "semantic", "formatting"]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const SeveritySchema = z.enum(["info", "warning", "error"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const RangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  unit: z.enum(["character", "paragraph", "section"]).default("character"),
});

export type Range = z.infer<typeof RangeSchema>;

export const FindingSchema = z.object({
  id: z.string().uuid(),
  kind: FindingKindSchema,
  category: z.string().trim().min(1),
  range: RangeSchema,
  message: z.string().trim().min(1),
  severity: SeveritySchema,
  evidence: z.string().trim().default(""),
  suggestedChangeId: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1),
});

export type Finding = z.infer<typeof FindingSchema>;
