/**
 * C3: temporal — the same event or date-bearing
 * predicate, with the date type distinguished.
 *
 * Retrieval: claims that share a date key and a
 * date role. An event date and a reporting date
 * that happen to fall on the same day are
 * different facts, so the role is part of the
 * subject: the subject is the event the claims
 * share, or the date-bearing predicate when no
 * event id is shared, and it carries the date
 * type so the distinction stays visible.
 */

import { dateKey } from "../normalisation/dates";
import type { ConsistencyCandidate, DecisionSubject } from "../contracts";
import type { CheckRetrieval, RetrievalContext } from "./kit";
import { capSubjectClaims, evidenceIdsFor, makeCandidate } from "./kit";

export function retrieveC3(ctx: RetrievalContext): CheckRetrieval {
  const candidates: ConsistencyCandidate[] = [];
  let blockOverflowSkipped = 0;
  let ordinal = 0;

  ctx.indices.temporal.dateKeys.forEach((key) => {
    const claimIds = ctx.indices.temporal.claimsFor(key);

    // Partition by date role: the date type is
    // distinguished before anything else.
    const byRole = new Map<string, string[]>();
    claimIds.forEach((claimId) => {
      const normalised = ctx.indices.claims.byId(claimId);
      if (normalised === null) return;
      normalised.dates.forEach(({ role, date }) => {
        if (dateKey(date) !== key) return;
        const bucket = byRole.get(role);
        if (bucket === undefined) {
          byRole.set(role, [claimId]);
        } else if (!bucket.includes(claimId)) {
          bucket.push(claimId);
        }
      });
    });

    byRole.forEach((roleClaimIds, role) => {
      // Partition by the event the claims share, or
      // by the date-bearing predicate when no event
      // id is shared.
      const groups = new Map<string, string[]>();
      roleClaimIds.forEach((claimId) => {
        const normalised = ctx.indices.claims.byId(claimId);
        if (normalised === null) return;
        const groupKey =
          normalised.claim.eventIds[0] ?? `predicate:${normalised.claim.predicate.text}`;
        const bucket = groups.get(groupKey);
        if (bucket === undefined) {
          groups.set(groupKey, [claimId]);
        } else if (!bucket.includes(claimId)) {
          bucket.push(claimId);
        }
      });

      groups.forEach((groupIds, groupKey) => {
        if (groupIds.length < 2) return;
        const { kept, skipped } = capSubjectClaims(groupIds, ctx.maxPerSubject);
        blockOverflowSkipped += skipped;
        ordinal += 1;
        const isEvent = !groupKey.startsWith("predicate:");
        const subject: DecisionSubject = {
          kind: "event",
          description: isEvent ? groupKey : groupKey.slice("predicate:".length),
          temporal: role,
        };
        candidates.push(
          makeCandidate(
            "C3",
            ordinal,
            subject,
            kept,
            {
              reasonCodes: [
                "shared-date",
                isEvent ? "shared-event" : "shared-predicate",
                `date-type:${role}`,
              ],
              sharedEntityIds: [],
              sharedEventIds: isEvent ? [groupKey] : [],
              sharedProgrammeIds: [],
              sharedMetricIds: [],
            },
            evidenceIdsFor(kept, ctx),
          ),
        );
      });
    });
  });

  return { candidates, blockOverflowSkipped };
}
