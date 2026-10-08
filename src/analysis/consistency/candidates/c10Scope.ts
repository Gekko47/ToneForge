/**
 * C10: scope — a universal or absolute claim,
 * and a plausible exception to it.
 *
 * Retrieval: every universal-scope claim, with
 * the exception-scope claims that share a term
 * or an entity with it — the exception is
 * plausible when it speaks the same language
 * as the universal claim's domain. The subject
 * is the entity both name, or the shared term
 * when neither names an entity, and the
 * comparison decides whether the exception
 * really carves part of the universal claim's
 * scope out of it.
 */

import { predicateTerms } from "../indices/TerminologyIndex";
import type { NormalisedClaim } from "../normalisation";
import type { ConsistencyCandidate, DecisionSubject } from "../contracts";
import type { CheckRetrieval, RetrievalContext } from "./kit";
import { capSubjectClaims, evidenceIdsFor, makeCandidate } from "./kit";

/** The entities a claim names: its subjects and objects. */
function namedEntities(claim: NormalisedClaim): readonly string[] {
  return [...claim.claim.subjectIds, ...claim.claim.objectIds];
}

export function retrieveC10(ctx: RetrievalContext): CheckRetrieval {
  const candidates: ConsistencyCandidate[] = [];
  let blockOverflowSkipped = 0;
  let ordinal = 0;

  const universals: NormalisedClaim[] = [];
  const exceptions: NormalisedClaim[] = [];
  ctx.indices.claims.claimIds.forEach((claimId) => {
    const normalised = ctx.indices.claims.byId(claimId);
    if (normalised === null) return;
    if (normalised.claim.scope.kind === "universal") {
      universals.push(normalised);
    } else if (normalised.claim.scope.kind === "exception") {
      exceptions.push(normalised);
    }
  });

  universals.forEach((universal) => {
    const universalTerms = predicateTerms(universal.claim.predicate.text);
    const universalEntities = namedEntities(universal);

    const plausible = exceptions.filter((exception) => {
      const exceptionEntities = namedEntities(exception);
      if (universalEntities.some((entityId) => exceptionEntities.includes(entityId))) {
        return true;
      }
      const exceptionTerms = predicateTerms(exception.claim.predicate.text);
      return universalTerms.some((term) => exceptionTerms.includes(term));
    });
    if (plausible.length === 0) return;

    // The subject is the entity both name, or the
    // first shared term in stable order.
    const sharedEntity = universalEntities.find((entityId) =>
      plausible.some((exception) => namedEntities(exception).includes(entityId)),
    );
    const sharedTerm = universalTerms.find((term) =>
      plausible.some((exception) => predicateTerms(exception.claim.predicate.text).includes(term)),
    );
    const subject: DecisionSubject =
      sharedEntity === undefined
        ? { kind: "term", term: sharedTerm ?? "universal-scope" }
        : { kind: "entity", name: sharedEntity, aliases: [] };

    const claimIds = [universal.claim.id, ...plausible.map((exception) => exception.claim.id)];
    const { kept, skipped } = capSubjectClaims(claimIds, ctx.maxPerSubject);
    blockOverflowSkipped += skipped;
    ordinal += 1;
    candidates.push(
      makeCandidate(
        "C10",
        ordinal,
        subject,
        kept,
        {
          reasonCodes: ["universal-scope", "plausible-exception"],
          sharedEntityIds: kept
            .map((id) => ctx.indices.claims.byId(id))
            .filter((c) => c !== null)
            .flatMap((c) => c.claim.subjectIds)
            .filter((v, i, a) => a.indexOf(v) === i)
            .filter((id) => ctx.indices.entities.entityIds.includes(id)),
          sharedEventIds: [],
          sharedProgrammeIds: [],
          sharedMetricIds: [],
        },
        evidenceIdsFor(kept, ctx),
      ),
    );
  });

  return { candidates, blockOverflowSkipped };
}
