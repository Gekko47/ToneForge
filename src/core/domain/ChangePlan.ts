/**
 * ChangePlan — the single mutation path.
 *
 * Deterministic and semantic engines produce Findings; the planner turns
 * them into a ChangePlan with conflict/stale checks. Only the Word revision
 * adapter consumes ChangePlan to mutate Word.
 */

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { ChangeSchema, type Change } from "./Change";
import { FindingSchema, type Finding } from "./Finding";

export const ConflictEntrySchema = z.object({
  message: z.string().trim().min(1),
  changeIds: z.array(z.string().uuid()),
});
export type ConflictEntry = z.infer<typeof ConflictEntrySchema>;

export const ChangePlanValidationSchema = z.object({
  protectionChecked: z.boolean().default(false),
  identityChecked: z.boolean().default(false),
  rangeChecked: z.boolean().default(false),
});
export type ChangePlanValidation = z.infer<typeof ChangePlanValidationSchema>;

export const ChangePlanSchema = z.object({
  id: z.string().uuid(),
  docHash: z.string().trim().min(1),
  baseDocId: z.string().trim().min(1),
  createdAt: z.string().datetime(),
  changes: z.array(ChangeSchema),
  conflicts: z.union([z.array(z.string()), z.array(ConflictEntrySchema)]).default([]),
  stale: z.boolean().default(false),
  findings: z.array(FindingSchema).optional(),
  // --- additive fields (Phase A) ---
  documentId: z.string().trim().optional(),
  documentVersion: z.string().optional(),
  contentHash: z.string().optional(),
  profileId: z.string().uuid().optional(),
  profileVersion: z.string().optional(),
  validation: ChangePlanValidationSchema.optional(),
});

export type ChangePlan = z.infer<typeof ChangePlanSchema>;

export function createChangePlan(
  docHash: string,
  baseDocId: string,
  changes: Change[],
  findings: Finding[] = [],
  extra?: {
    documentId?: string;
    documentVersion?: string;
    contentHash?: string;
    profileId?: string;
    profileVersion?: string;
    validation?: ChangePlanValidation;
  },
): ChangePlan {
  return ChangePlanSchema.parse({
    id: uuidv4(),
    docHash,
    baseDocId,
    createdAt: new Date().toISOString(),
    changes,
    conflicts: [],
    stale: false,
    findings,
    ...extra,
  });
}
