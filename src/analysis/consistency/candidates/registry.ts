/**
 * The retrieval registry (original §9 and §10).
 *
 * Each C-check retrieves only plausible subjects from
 * the indices — no window scanning, no pairwise
 * comparison of everything. A candidate is never a
 * user-facing issue by itself: it names a subject and
 * the claims that bear on it, and the comparison
 * stages decide what, if anything, is wrong.
 *
 * A subject with more statements than the per-subject
 * cap contributes the first `maxPerSubject` and reports
 * the rest as `blockOverflowSkipped`: a capped run is
 * a partial run, and the count says so.
 *
 * The shared helpers the retrievers use live in `kit`,
 * apart from this dispatch: the retrievers depend on
 * the kit, and this registry depends on the retrievers,
 * so neither side imports the other mid-evaluation.
 */

import type { ConsistencyCandidate, ConsistencyCheckId } from "../contracts";
import type { CheckRetriever, RetrievalContext } from "./kit";
import { retrieveC1 } from "./c1Terminology";
import { retrieveC2 } from "./c2Numeric";
import { retrieveC3 } from "./c3Temporal";
import { retrieveC4 } from "./c4EntityAttribute";
import { retrieveC5 } from "./c5Definition";
import { retrieveC6 } from "./c6Unit";
import { retrieveC7 } from "./c7Status";
import { retrieveC8 } from "./c8Reference";
import { retrieveC9 } from "./c9SectionPromise";
import { retrieveC10 } from "./c10Scope";

export {
  capSubjectClaims,
  evidenceIdsFor,
  makeCandidate,
  subjectKey,
  type CheckRetrieval,
  type CheckRetriever,
  type RetrievalContext,
} from "./kit";

/**
 * The ten retrievers, one per check (original §9).
 *
 * C8 and C9 retrieve on reference and section subjects
 * — a citation and its content are one subject, a
 * heading promise and its section are one subject —
 * and are never forced into a claim-pair model.
 */
const RETRIEVERS: Readonly<Record<ConsistencyCheckId, CheckRetriever>> = Object.freeze({
  C1: retrieveC1,
  C2: retrieveC2,
  C3: retrieveC3,
  C4: retrieveC4,
  C5: retrieveC5,
  C6: retrieveC6,
  C7: retrieveC7,
  C8: retrieveC8,
  C9: retrieveC9,
  C10: retrieveC10,
});

/**
 * Run every check's retrieval over the indices.
 *
 * Each check retrieves only the subjects its rule
 * names; the caps bound what a subject contributes,
 * and everything the caps skip is counted, so a
 * partial retrieval is reported as partial.
 */
export function retrieveCandidates(ctx: RetrievalContext): {
  candidates: readonly ConsistencyCandidate[];
  blockOverflowSkipped: number;
  perCheck: Readonly<Record<string, number>>;
} {
  const candidates: ConsistencyCandidate[] = [];
  const perCheck: Record<string, number> = {};
  let blockOverflowSkipped = 0;
  (Object.keys(RETRIEVERS) as ConsistencyCheckId[]).forEach((checkId) => {
    const retriever = RETRIEVERS[checkId];
    const retrieval =
      retriever === undefined ? { candidates: [], blockOverflowSkipped: 0 } : retriever(ctx);
    perCheck[checkId] = retrieval.candidates.length;
    blockOverflowSkipped += retrieval.blockOverflowSkipped;
    candidates.push(...retrieval.candidates);
  });
  return { candidates, blockOverflowSkipped, perCheck };
}
