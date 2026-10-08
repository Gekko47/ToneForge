/**
 * C4: entity attribute — the same entity, the same
 * attribute, under a changing programme, time, or
 * scenario.
 *
 * Retrieval: for every entity, the claims that
 * assert the same attribute (predicate) about it.
 * The changing context is the gate: a programme
 * revision, a later date, or another scenario is
 * why the same attribute may legitimately differ,
 * and the reason codes say which changed. The
 * comparison decides whether the difference is
 * explained or contradictory.
 */

import { dateKey } from "../normalisation/dates";
import type { NormalisedClaim } from "../normalisation";
import type { ConsistencyCandidate, DecisionSubject } from "../contracts";
import type { CheckRetrieval, RetrievalContext } from "./kit";
import { capSubjectClaims, evidenceIdsFor, makeCandidate } from "./kit";

/**
 * Which parts of the context change across a group
 * of claims: programme, scenario, or time.
 */
function contextChanges(claims: readonly NormalisedClaim[]): string[] {
  const changes: string[] = [];
  const programmes = new Set(claims.map(({ claim }) => [...claim.programmeIds].sort().join("+")));
  if (programmes.size > 1) changes.push("changing-programme");
  const scenarios = new Set(claims.map(({ claim }) => claim.scenario?.type ?? "none"));
  if (scenarios.size > 1) changes.push("changing-scenario");
  const dates = new Set(
    claims.map(({ dates }) =>
      dates
        .map(({ date }) => dateKey(date) ?? "")
        .sort()
        .join("+"),
    ),
  );
  if (dates.size > 1) changes.push("changing-time");
  return changes;
}

export function retrieveC4(ctx: RetrievalContext): CheckRetrieval {
  const candidates: ConsistencyCandidate[] = [];
  let blockOverflowSkipped = 0;
  let ordinal = 0;

  ctx.indices.entities.entityIds.forEach((entityId) => {
    const claimIds = ctx.indices.entities.claimsFor(entityId);

    // Group by the attribute asserted: the predicate.
    const byAttribute = new Map<string, string[]>();
    claimIds.forEach((claimId) => {
      const normalised = ctx.indices.claims.byId(claimId);
      if (normalised === null) return;
      const attribute = normalised.claim.predicate.text;
      const bucket = byAttribute.get(attribute);
      if (bucket === undefined) {
        byAttribute.set(attribute, [claimId]);
      } else if (!bucket.includes(claimId)) {
        bucket.push(claimId);
      }
    });

    byAttribute.forEach((groupIds) => {
      if (groupIds.length < 2) return;
      const group = groupIds
        .map((id) => ctx.indices.claims.byId(id))
        .filter((normalised): normalised is NormalisedClaim => normalised !== null);
      const changes = contextChanges(group);
      const { kept, skipped } = capSubjectClaims(groupIds, ctx.maxPerSubject);
      blockOverflowSkipped += skipped;
      ordinal += 1;
      const labels = ctx.aliases.labelsFor(entityId);
      const subject: DecisionSubject = {
        kind: "entity",
        name: labels[0] ?? entityId,
        aliases: labels.slice(1),
      };
      candidates.push(
        makeCandidate(
          "C4",
          ordinal,
          subject,
          kept,
          {
            reasonCodes: ["shared-entity", "shared-attribute", ...changes],
            sharedEntityIds: kept
              .map((id) => ctx.indices.claims.byId(id))
              .filter((c) => c !== null)
              .flatMap((c) => c.claim.subjectIds)
              .filter((v, i, a) => a.indexOf(v) === i)
              .filter((id) => ctx.indices.entities.entityIds.includes(id)),
            sharedEventIds: [],
            sharedProgrammeIds: group[0] === undefined ? [] : [...group[0].claim.programmeIds],
            sharedMetricIds: [],
          },
          evidenceIdsFor(kept, ctx),
        ),
      );
    });
  });

  return { candidates, blockOverflowSkipped };
}
