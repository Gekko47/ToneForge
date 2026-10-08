/**
 * C1: terminology — the same concept, entity, or
 * event under multiple labels or usages.
 *
 * Retrieval: every entity and every event that two
 * or more claims assert about, where the claims use
 * the subject in more than one way — their
 * predicates are not all the same. The subject is
 * the entity or the event, never a claim pair: the
 * comparison stage decides whether the usages drift.
 *
 * An entity the alias index holds under more than
 * one label is retrieved on the strength of its
 * labels alone, because the document calling one
 * thing two names is the drift C1 exists to surface.
 */

import type { ConsistencyCandidate, DecisionSubject } from "../contracts";
import type { CheckRetrieval, RetrievalContext } from "./kit";
import { capSubjectClaims, evidenceIdsFor, makeCandidate } from "./kit";

export function retrieveC1(ctx: RetrievalContext): CheckRetrieval {
  const candidates: ConsistencyCandidate[] = [];
  let blockOverflowSkipped = 0;
  let ordinal = 0;

  const retrieve = (
    subject: DecisionSubject,
    claimIds: readonly string[],
    reasonCodes: readonly string[],
  ): void => {
    if (claimIds.length < 2) return;
    const predicates = claimIds.map(
      (id) => ctx.indices.claims.byId(id)?.claim.predicate.text ?? "",
    );
    const first = predicates[0] ?? "";
    if (predicates.every((text) => text === first)) return;
    const { kept, skipped } = capSubjectClaims(claimIds, ctx.maxPerSubject);
    blockOverflowSkipped += skipped;
    ordinal += 1;
    candidates.push(
      makeCandidate(
        "C1",
        ordinal,
        subject,
        kept,
        {
          reasonCodes: [...reasonCodes, "multiple-usages"],
          sharedEntityIds: kept
            .map((id) => ctx.indices.claims.byId(id))
            .filter((c) => c !== null)
            .flatMap((c) => c.claim.subjectIds)
            .filter((v, i, a) => a.indexOf(v) === i)
            .filter((id) => ctx.indices.entities.entityIds.includes(id)),
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
    const subject: DecisionSubject = {
      kind: "entity",
      name: labels[0] ?? entityId,
      aliases: labels.slice(1),
    };
    retrieve(
      subject,
      ctx.indices.entities.claimsFor(entityId),
      labels.length > 1 ? ["shared-entity", "multiple-labels"] : ["shared-entity"],
    );
  });

  ctx.indices.events.eventIds.forEach((eventId) => {
    retrieve({ kind: "event", description: eventId }, ctx.indices.events.claimsFor(eventId), [
      "shared-event",
    ]);
  });

  return { candidates, blockOverflowSkipped };
}
