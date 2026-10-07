/**
 * C6: unit — the same measure, metric, entity,
 * or event, stated in units that convert into
 * one another.
 *
 * Retrieval: claims that share a metric
 * (predicate), an entity, or an event, and
 * assert values in compatible but different
 * units. The units are converted to the
 * dimension's base unit before comparison —
 * the subject carries the base unit, so "two
 * weeks" and "14 days" meet as one measure.
 *
 * A unit the engine cannot convert is never
 * guessed at: two unknown units are compatible
 * only when they are the same word, and same
 * words need no conversion.
 */

import { baseUnit, compatibleUnits } from "../normalisation/quantities";
import type { ConsistencyCandidate, DecisionSubject } from "../contracts";
import type { CheckRetrieval, RetrievalContext } from "./kit";
import { capSubjectClaims, evidenceIdsFor, makeCandidate } from "./kit";

/**
 * Whether a group of claims asserts values in
 * compatible but different units, and the base
 * unit those units convert into.
 */
function convertibleUnits(claimIds: readonly string[], ctx: RetrievalContext): string | null {
  const units = new Set<string>();
  claimIds.forEach((claimId) => {
    const normalised = ctx.indices.claims.byId(claimId);
    normalised?.values.forEach((value) => {
      if (value.unit !== undefined) units.add(value.unit);
    });
  });
  const unitList = [...units];
  let base: string | null = null;
  unitList.forEach((a, index) => {
    unitList.slice(index + 1).forEach((b) => {
      if (a === b) return;
      if (!compatibleUnits(a, b)) return;
      if (base === null) base = baseUnit(a);
    });
  });
  return base;
}

export function retrieveC6(ctx: RetrievalContext): CheckRetrieval {
  const candidates: ConsistencyCandidate[] = [];
  let blockOverflowSkipped = 0;
  let ordinal = 0;

  const retrieve = (
    subject: DecisionSubject,
    claimIds: readonly string[],
    reasonCodes: readonly string[],
    sharedMetricIds: readonly string[],
  ): void => {
    if (claimIds.length < 2) return;
    const base = convertibleUnits(claimIds, ctx);
    if (base === null) return;
    const { kept, skipped } = capSubjectClaims(claimIds, ctx.maxPerSubject);
    blockOverflowSkipped += skipped;
    ordinal += 1;
    candidates.push(
      makeCandidate(
        "C6",
        ordinal,
        subject,
        kept,
        {
          reasonCodes: [...reasonCodes, "convert-units"],
          sharedEntityIds: subject.kind === "entity" ? [subject.name] : [],
          sharedEventIds: subject.kind === "event" ? [subject.description] : [],
          sharedProgrammeIds: [],
          sharedMetricIds: [...sharedMetricIds],
        },
        evidenceIdsFor(kept, ctx),
      ),
    );
  };

  // By metric: the same measure, in convertible units.
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
    retrieve(
      { kind: "quantum", measure: predicate, unit: "" },
      claimIds,
      ["shared-metric"],
      [predicate],
    );
  });

  // By entity and by event: the same thing, measured
  // in convertible units.
  ctx.indices.entities.entityIds.forEach((entityId) => {
    const labels = ctx.aliases.labelsFor(entityId);
    retrieve(
      {
        kind: "entity",
        name: labels[0] ?? entityId,
        aliases: labels.slice(1),
      },
      ctx.indices.entities.claimsFor(entityId),
      ["shared-entity"],
      [],
    );
  });
  ctx.indices.events.eventIds.forEach((eventId) => {
    retrieve(
      { kind: "event", description: eventId },
      ctx.indices.events.claimsFor(eventId),
      ["shared-event"],
      [],
    );
  });

  return { candidates, blockOverflowSkipped };
}
