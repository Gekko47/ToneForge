import type { Finding } from "../core/domain/Finding";
import { hashText } from "../shared/utils/text";

/**
 * The identity of the *kind* of problem a finding reports.
 *
 * It deliberately excludes the range. Two properties pull against each other:
 *
 *  - It must survive a rescan. Findings are re-derived with fresh uuids, and
 *    any edit earlier in the document shifts every absolute offset after it, so
 *    neither the id nor the range can be part of the identity.
 *  - It must distinguish two occurrences of the same rule.
 *
 * Excluding the range satisfies the first and breaks the second, because a
 * document with ninety em-dashes produces ninety findings that differ *only*
 * by offset. So this hash is the identity of a rule, never of an occurrence —
 * and the occurrence is matched separately by `isIgnoredFinding`, which has the
 * range available and can compare positions.
 *
 * Using this alone to decide what is ignored is the bug that made ignoring one
 * em dash hide the other eighty-nine. The message is excluded for the same
 * reason it is here: it is a label, and rewording it between versions must not
 * resurrect an ignored finding.
 */
export function findingFingerprint(finding: Finding): string {
  const identity = {
    kind: finding.kind,
    category: finding.category,
    ruleId: finding.ruleId ?? null,
    nodeIds: [...finding.nodeIds].sort(),
    actual: finding.actual ?? finding.evidence,
    expected: finding.expected ?? null,
    transformation: finding.transformation ?? null,
  };
  return hashText(JSON.stringify(identity));
}
