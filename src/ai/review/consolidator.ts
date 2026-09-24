import type { Change } from "../../core/domain/Change";
import type { Finding } from "../../core/domain/Finding";
import { unifyFindings } from "../../analysis/unifiedFindings";

export interface ConsolidatedReview {
  findings: Finding[];
  changes: Change[];
}

/** Consolidate duplicate AI findings while retaining their change linkage. */
export function consolidateReviewFindings(
  findings: readonly Finding[],
  changes: readonly Change[],
): ConsolidatedReview {
  const unified = unifyFindings({
    deterministic: [],
    formatting: [],
    semantic: [...findings],
  });
  const retainedIds = new Set(unified.map((finding) => finding.id));
  return {
    findings: unified,
    changes: changes.filter(
      (change) => change.findingId === undefined || retainedIds.has(change.findingId),
    ),
  };
}
