/** Pure approval policy for immutable finding-to-change propagation. */

import type { Finding } from "../core/domain/Finding";
import { ruleForSource, type GovernanceRule } from "../core/domain/GovernanceProfile";

export interface ChangeApprovalPolicy {
  approvalRequired: boolean;
  approvalState: "notRequired" | "pending" | "approved" | "rejected";
}

/**
 * The finding-derived baseline.
 *
 * This is the floor, not the answer. A governance rule can raise it — a
 * mandatory, non-auto-fixing rule means a change must be read before it is
 * written even when the finding alone looks trivially safe — but it cannot
 * lower it. That asymmetry is deliberate: policy may add caution, and a policy
 * the author can use to remove it is not a safety control.
 */
export function approvalPolicyForFinding(
  finding: Finding,
  rule: GovernanceRule | null = null,
): ChangeApprovalPolicy {
  const derived =
    finding.source === "ai" ||
    finding.source === "profile" ||
    finding.risk === "medium" ||
    finding.risk === "high" ||
    !finding.reversible;

  // A mandatory rule means the author has said this must never be applied
  // unreviewed, whatever the finding's own risk happens to be.
  const approvalRequired = derived || (rule !== null && rule.severity === "mandatory");

  if (!approvalRequired) return { approvalRequired: false, approvalState: "notRequired" };
  if (finding.status === "accepted") return { approvalRequired: true, approvalState: "approved" };
  if (finding.status === "ignored" || finding.status === "deferred") {
    return { approvalRequired: true, approvalState: "rejected" };
  }
  return { approvalRequired: true, approvalState: "pending" };
}

/** Look up the governance rule for a finding, when policy is supplied. */
export function ruleForFinding(
  finding: Finding,
  rules: readonly GovernanceRule[] | undefined,
): GovernanceRule | null {
  return rules === undefined ? null : ruleForSource(rules, finding.category);
}
