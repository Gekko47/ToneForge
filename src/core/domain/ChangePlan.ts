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
  preconditionsChecked: z.boolean().default(false),
  approvalsChecked: z.boolean().default(false),
});
export type ChangePlanValidation = z.infer<typeof ChangePlanValidationSchema>;

export const ChangePlanSchema = z
  .object({
    /** Version 1 accepts legacy changes; version 2 requires preconditions and approval checks. */
    schemaVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    /** Governance policy revision captured when the plan was created. */
    governancePolicyRevision: z.number().int().nonnegative().optional(),
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
    structuralHash: z.string().trim().optional(),
    analysisText: z.string().optional(),
    analysisStart: z.number().int().nonnegative().optional(),
    analysisEnd: z.number().int().nonnegative().optional(),
    analysisTruncated: z.boolean().optional(),
    validation: ChangePlanValidationSchema.optional(),
  })
  .superRefine((plan, ctx) => {
    if (plan.schemaVersion !== 2) return;
    plan.changes.forEach((change, index) => {
      if (change.precondition === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Change ${change.id} requires an exact text or node precondition`,
          path: ["changes", index, "precondition"],
        });
      }
      if (change.approvalRequired === undefined || change.approvalState === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Change ${change.id} requires explicit approval metadata`,
          path: ["changes", index, "approvalState"],
        });
      }
    });
  });

export type ChangePlan = z.infer<typeof ChangePlanSchema>;
export type ChangePlanInput = z.input<typeof ChangePlanSchema>;

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
    structuralHash?: string;
    analysisText?: string;
    analysisStart?: number;
    analysisEnd?: number;
    analysisTruncated?: boolean;
    validation?: ChangePlanValidation;
    schemaVersion?: 1 | 2;
    governancePolicyRevision?: number;
  },
): ChangePlan {
  return ChangePlanSchema.parse({
    ...(extra?.schemaVersion === undefined ? {} : { schemaVersion: extra.schemaVersion }),
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
