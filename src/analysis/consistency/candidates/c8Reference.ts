/**
 * C8: reference — a claim and the content its
 * citation points at.
 *
 * Retrieval: every citation the reference index
 * holds, with the claims that cite it. The
 * citation and its content are one subject — a
 * reference subject, not a claim pair — so the
 * comparison can decide whether what the claim
 * asserts about the cited content is what the
 * content says.
 */

import type { ConsistencyCandidate } from "../contracts";
import type { CheckRetrieval, RetrievalContext } from "./kit";
import { capSubjectClaims, evidenceIdsFor, makeCandidate } from "./kit";

export function retrieveC8(ctx: RetrievalContext): CheckRetrieval {
  const candidates: ConsistencyCandidate[] = [];
  let blockOverflowSkipped = 0;
  let ordinal = 0;

  ctx.indices.references.citations.forEach((citation) => {
    const claimIds = ctx.indices.references.claimsFor(citation);
    const { kept, skipped } = capSubjectClaims(claimIds, ctx.maxPerSubject);
    blockOverflowSkipped += skipped;
    ordinal += 1;
    candidates.push(
      makeCandidate(
        "C8",
        ordinal,
        { kind: "reference", citation },
        kept,
        {
          reasonCodes: ["cited-reference"],
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
