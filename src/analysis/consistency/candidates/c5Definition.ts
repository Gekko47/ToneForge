/**
 * C5: definition — the definitions and usages of
 * one canonical term.
 *
 * Retrieval: for every term the terminology index
 * holds, the claims that define it (a definition
 * predicate) and the claims that use it. A term
 * with both a definition and a usage is retrieved
 * as one subject — the term — so the comparison
 * can decide whether the usage matches the
 * definition.
 */

import type { ConsistencyCandidate } from "../contracts";
import type { CheckRetrieval, RetrievalContext } from "./kit";
import { capSubjectClaims, evidenceIdsFor, makeCandidate } from "./kit";

export function retrieveC5(ctx: RetrievalContext): CheckRetrieval {
  const candidates: ConsistencyCandidate[] = [];
  let blockOverflowSkipped = 0;
  let ordinal = 0;

  ctx.indices.terminology.terms.forEach((term) => {
    const claimIds = ctx.indices.terminology.claimsFor(term);
    const definitions = claimIds.filter((id) => {
      const normalised = ctx.indices.claims.byId(id);
      if (normalised === null) return false;
      const predicate = normalised.claim.predicate;
      return (
        predicate.kind === "definition" ||
        /define|definition|means|refers to|is defined as/i.test(predicate.text)
      );
    });
    if (definitions.length === 0) return;
    const usages = claimIds.filter((id) => !definitions.includes(id));
    if (usages.length === 0) return;

    const groupIds = [...definitions, ...usages];
    const { kept, skipped } = capSubjectClaims(groupIds, ctx.maxPerSubject);
    blockOverflowSkipped += skipped;
    ordinal += 1;
    candidates.push(
      makeCandidate(
        "C5",
        ordinal,
        { kind: "term", term },
        kept,
        {
          reasonCodes: ["defined-term", "term-usage"],
          sharedEntityIds: [],
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
