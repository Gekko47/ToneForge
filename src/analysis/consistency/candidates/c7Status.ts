/**
 * C7: status — the same subject or event, with
 * potentially exclusive states.
 *
 * Retrieval: for every entity and every event,
 * the claims that assert a state about it,
 * when two of those states cannot both be
 * true ("enabled" against "disabled"). The
 * subject is the entity or the event; the
 * comparison decides whether the states really
 * conflict, or apply at different times or
 * under different scenarios.
 */

import { contentWords, EXCLUSIVE_STATES } from "../checks/primitives";
import type { ConsistencyCandidate, DecisionSubject } from "../contracts";
import type { CheckRetrieval, RetrievalContext } from "./kit";
import { capSubjectClaims, evidenceIdsFor, makeCandidate } from "./kit";

/** The state words a claim's predicate asserts. */
function statusWords(predicateText: string): string[] {
  return contentWords(predicateText).filter((word) =>
    EXCLUSIVE_STATES.some(([a, b]) => word === a || word === b),
  );
}

export function retrieveC7(ctx: RetrievalContext): CheckRetrieval {
  const candidates: ConsistencyCandidate[] = [];
  let blockOverflowSkipped = 0;
  let ordinal = 0;

  const retrieve = (
    subject: DecisionSubject,
    claimIds: readonly string[],
    reason: string,
  ): void => {
    const carriers = claimIds.filter((claimId) => {
      const normalised = ctx.indices.claims.byId(claimId);
      return normalised !== null && statusWords(normalised.claim.predicate.text).length > 0;
    });
    if (carriers.length < 2) return;

    const words = new Set<string>();
    carriers.forEach((claimId) => {
      const normalised = ctx.indices.claims.byId(claimId);
      statusWords(normalised?.claim.predicate.text ?? "").forEach((word) => words.add(word));
    });
    const exclusive = EXCLUSIVE_STATES.some(([a, b]) => words.has(a) && words.has(b));
    if (!exclusive) return;

    const { kept, skipped } = capSubjectClaims(carriers, ctx.maxPerSubject);
    blockOverflowSkipped += skipped;
    ordinal += 1;
    candidates.push(
      makeCandidate(
        "C7",
        ordinal,
        subject,
        kept,
        {
          reasonCodes: [reason, "exclusive-status"],
          sharedEntityIds: subject.kind === "entity" ? [subject.name] : [],
          sharedEventIds: subject.kind === "event" ? [subject.description] : [],
          sharedProgrammeIds: [],
          sharedMetricIds: [],
        },
        evidenceIdsFor(kept, ctx),
      ),
    );
  };

  ctx.indices.entities.entityIds.forEach((entityId) => {
    const labels = ctx.aliases.labelsFor(entityId);
    retrieve(
      {
        kind: "entity",
        name: labels[0] ?? entityId,
        aliases: labels.slice(1),
      },
      ctx.indices.entities.claimsFor(entityId),
      "shared-entity",
    );
  });
  ctx.indices.events.eventIds.forEach((eventId) => {
    retrieve(
      { kind: "event", description: eventId },
      ctx.indices.events.claimsFor(eventId),
      "shared-event",
    );
  });

  return { candidates, blockOverflowSkipped };
}
