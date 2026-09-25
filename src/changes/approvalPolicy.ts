/** Pure approval policy for immutable finding-to-change propagation. */

import type { Finding } from "../core/domain/Finding";

export interface ChangeApprovalPolicy {
  approvalRequired: boolean;
  approvalState: "notRequired" | "pending" | "approved" | "rejected";
}

export function approvalPolicyForFinding(finding: Finding): ChangeApprovalPolicy {
  const approvalRequired =
    finding.source === "ai" ||
    finding.source === "profile" ||
    finding.risk === "medium" ||
    finding.risk === "high" ||
    !finding.reversible;

  if (!approvalRequired) return { approvalRequired: false, approvalState: "notRequired" };
  if (finding.status === "accepted") return { approvalRequired: true, approvalState: "approved" };
  if (finding.status === "ignored" || finding.status === "deferred") {
    return { approvalRequired: true, approvalState: "rejected" };
  }
  return { approvalRequired: true, approvalState: "pending" };
}
