import type { Finding } from "../core/domain/Finding";
import { findingFingerprint } from "./findingFingerprint";

/**
 * The identity of a review decision: the same rule, at the same place.
 *
 * A review is recorded against a finding the user clicked, and it has to be
 * matched against a *different run's* finding — the preview that built the plan
 * issues its own uuids, so the id the user clicked never reappears. Matching on
 * the id alone would mean a reviewed finding never reaches Pending Changes, and
 * the reviewed-only list would be permanently empty.
 *
 * The pair solves it, and each half is doing a job the other cannot:
 *
 * - The fingerprint is the rule. It excludes the range deliberately, so it
 *   survives a re-scan, and it is what stops one review from covering every
 *   occurrence of the same rule in the document.
 * - The offset is the occurrence. Without it, ninety em-dashes share one
 *   fingerprint and reviewing the first would queue all ninety — the exact
 *   defect `isIgnoredFinding` was written to fix.
 *
 * Offsets are compared exactly here, not with the tolerance that module uses.
 * That is a deliberate difference: an ignore should survive the user typing
 * somewhere above it, but a review must not. It was given for specific text in
 * a specific plan, and carrying it onto a plan built from different text would
 * apply something the user never looked at — the very thing this identity
 * exists to prevent. When the document changes, the key stops matching, the
 * reviewed set empties, and the user reviews again. That is the safe direction
 * to fail in.
 */
export function reviewKey(finding: Finding): string {
  return `${findingFingerprint(finding)}@${finding.range.start}`;
}

/** A set of review keys, built from the findings the user actually clicked. */
export function toReviewKeys(findings: readonly Finding[]): Set<string> {
  return new Set(findings.map(reviewKey));
}
