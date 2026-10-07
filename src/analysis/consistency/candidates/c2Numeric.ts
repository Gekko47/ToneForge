/**
 * C2: numeric — the same metric, asserted more than
 * once in a compatible context.
 *
 * Retrieval: claims that share a predicate (the
 * metric) and agree on scenario, scope, basis,
 * entity, and event. Two figures for one metric in
 * one context are the same measurement stated
 * twice — which is exactly what may hide a
 * contradiction, so they are retrieved; the
 * comparison decides whether they agree.
 *
 * Claims whose context differs are not retrieved
 * together: a figure in another scenario, another
 * programme, or another basis is a different
 * measurement, and comparing them is how a false
 * contradiction is manufactured.
 */

import { normalizeForComparison } from "../checks/primitives";
import type { ConsistencyCandidate, ExpertReportClaim } from "../contracts";
import type { CheckRetrieval, RetrievalContext } from "./kit";
import { capSubjectClaims, evidenceIdsFor, makeCandidate } from "./kit";

/**
 * The context a claim is stated in: scenario, scope,
 * basis, entities, and events. Two claims with one
 * signature assert the same metric in the same
 * context, so their figures are comparable.
 */
function contextSignature(claim: ExpertReportClaim): string {
  return [
    claim.scenario?.type ?? "none",
    claim.scope.kind,
    claim.quantum?.basis ?? claim.delay?.durationBasis ?? "none",
    [...claim.subjectIds, ...claim.objectIds, ...claim.workItemIds].sort().join("+") || "none",
    [...claim.eventIds].sort().join("+") || "none",
  ].join("|");
}

export function retrieveC2(ctx: RetrievalContext): CheckRetrieval {
  const candidates: ConsistencyCandidate[] = [];
  let blockOverflowSkipped = 0;
  let ordinal = 0;

  const byPredicate = new Map<string, string[]>();
  ctx.indices.claims.claimIds.forEach((claimId) => {
    const normalised = ctx.indices.claims.byId(claimId);
    if (normalised === null) return;
    const predicate = normalised.claim.predicate.text;
    const bucket = byPredicate.get(predicate);
    if (bucket === undefined) {
      byPredicate.set(predicate, [claimId]);
    } else if (!bucket.includes(claimId)) {
      bucket.push(claimId);
    }
  });

  byPredicate.forEach((claimIds, predicate) => {
    const groups = new Map<string, string[]>();
    claimIds.forEach((claimId) => {
      const normalised = ctx.indices.claims.byId(claimId);
      if (normalised === null) return;
      const signature = contextSignature(normalised.claim);
      const bucket = groups.get(signature);
      if (bucket === undefined) {
        groups.set(signature, [claimId]);
      } else if (!bucket.includes(claimId)) {
        bucket.push(claimId);
      }
    });

    groups.forEach((groupIds) => {
      if (groupIds.length < 2) return;
      const { kept, skipped } = capSubjectClaims(groupIds, ctx.maxPerSubject);
      blockOverflowSkipped += skipped;
      ordinal += 1;
      const first = ctx.indices.claims.byId(groupIds[0] ?? "");
      candidates.push(
        makeCandidate(
          "C2",
          ordinal,
          {
            kind: "quantum",
            measure: predicate,
            unit: first?.values[0]?.unit ?? "",
          },
          kept,
          {
            reasonCodes: ["shared-metric", "compatible-context"],
            sharedEntityIds: first ? [...first.claim.subjectIds] : [],
            sharedEventIds: first ? [...first.claim.eventIds] : [],
            sharedProgrammeIds: first ? [...first.claim.programmeIds] : [],
            sharedMetricIds: [normalizeForComparison(predicate)],
          },
          evidenceIdsFor(kept, ctx),
        ),
      );
    });
  });

  return { candidates, blockOverflowSkipped };
}
