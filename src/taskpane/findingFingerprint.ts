import type { Finding } from "../core/domain/Finding";
import { hashText } from "../shared/utils/text";

/**
 * Stable across analysis reruns and across edits elsewhere in the document:
 * generated finding UUIDs and absolute character offsets are excluded, so a
 * finding keeps its identity when text before it shifts its range.
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
