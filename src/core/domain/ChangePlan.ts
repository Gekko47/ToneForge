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

export const ChangePlanSchema = z.object({
  id: z.string().uuid(),
  docHash: z.string().trim().min(1),
  baseDocId: z.string().trim().min(1),
  createdAt: z.string().datetime(),
  changes: z.array(ChangeSchema),
  conflicts: z.array(z.string()),
  stale: z.boolean().default(false),
  findings: z.array(FindingSchema).optional(),
});

export type ChangePlan = z.infer<typeof ChangePlanSchema>;

export function createChangePlan(
  docHash: string,
  baseDocId: string,
  changes: Change[],
  findings: Finding[] = [],
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
  });
}
