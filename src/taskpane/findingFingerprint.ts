import type { Finding } from "../core/domain/Finding";
import { hashText } from "../shared/utils/text";

/** Stable across analysis reruns because generated finding UUIDs are excluded. */
export function findingFingerprint(finding: Finding): string {
  const identity = {
    kind: finding.kind,
    category: finding.category,
    ruleId: finding.ruleId ?? null,
    nodeIds: [...finding.nodeIds].sort(),
    range: finding.range,
    actual: finding.actual ?? finding.evidence,
    expected: finding.expected ?? null,
    transformation: finding.transformation ?? null,
  };
  return hashText(JSON.stringify(identity));
}
