/**
 * C9: section promise — a heading's promise and
 * the content indexed under it.
 *
 * Retrieval: every section the section index
 * holds, with the claims whose evidence lands
 * in it. The heading and its content are one
 * subject — a section subject, not a claim
 * pair — so the comparison can decide whether
 * the section's content is what its heading
 * promises.
 */

import type { ConsistencyCandidate } from "../contracts";
import type { CheckRetrieval, RetrievalContext } from "./kit";
import { capSubjectClaims, evidenceIdsFor, makeCandidate } from "./kit";

export function retrieveC9(ctx: RetrievalContext): CheckRetrieval {
  const candidates: ConsistencyCandidate[] = [];
  let blockOverflowSkipped = 0;
  let ordinal = 0;

  ctx.indices.sections.sections.forEach((section) => {
    const claimIds = ctx.indices.sections.claimsFor(section);
    const { kept, skipped } = capSubjectClaims(claimIds, ctx.maxPerSubject);
    blockOverflowSkipped += skipped;
    ordinal += 1;
    candidates.push(
      makeCandidate(
        "C9",
        ordinal,
        { kind: "section", heading: section },
        kept,
        {
          reasonCodes: ["section-content"],
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
