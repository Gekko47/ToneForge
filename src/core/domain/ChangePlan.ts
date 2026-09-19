/**
 * ChangePlan — the single mutation path.
 *
 * Deterministic and semantic engines produce Findings; the planner turns
 * them into a ChangePlan with conflict/stale checks. Only the Word revision
 * adapter consumes ChangePlan to mutate Word.
 */

import { z } from "zod";
import { ChangeSchema, type Change } from "./Change";

export const ChangePlanSchema = z.object({
  id: z.string().uuid(),
  docHash: z.string().trim().min(1),
  baseDocId: z.string().trim().min(1),
  createdAt: z.string().datetime(),
  changes: z.array(ChangeSchema),
  conflicts: z.array(z.string()),
  stale: z.boolean().default(false),
});

export type ChangePlan = z.infer<typeof ChangePlanSchema>;

export function createChangePlan(
  docHash: string,
  baseDocId: string,
  changes: Change[],
): ChangePlan {
  return ChangePlanSchema.parse({
    id: crypto.randomUUID(),
    docHash,
    baseDocId,
    createdAt: new Date().toISOString(),
    changes,
    conflicts: [],
    stale: false,
  });
}
