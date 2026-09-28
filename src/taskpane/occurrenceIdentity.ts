/**
 * Occurrence identity — the two different questions the pane asks about a finding.
 *
 * **Why there are two.** "Stop showing me this" and "I approve changing this" are
 * not the same decision, and they do not survive the same events:
 *
 * - **Review** is consent to write a specific correction into a specific place.
 *   If the user types a paragraph above it, the correction the pane would write is
 *   no longer the one they looked at. So a review is tied to the *current* text
 *   and expires when that text moves. Failing in that direction is safe: the
 *   review is dropped, and nothing is applied without being looked at again.
 * - **Ignore** is "do not tell me about this again". The problem is still there
 *   and still in the document; the user simply set it aside. An edit above it
 *   does not change that, so an ignore has to tolerate relocation or it silently
 *   stops working the first time the user types.
 *
 * A single shared key cannot serve both. The one key this module replaces tried,
 * and produced two defects at once: ignoring one em dash hid the other
 * eighty-nine (a rule identity used for an occurrence decision), and a reviewed
 * finding vanished from Pending Changes whenever the document shifted by one
 * character (an occurrence identity used where relocation had to be tolerated).
 *
 * Pure: no React, no Office, no storage. Every policy here is a pure function so
 * it can be pinned by a test without a host.
 */

import type { Finding, IgnoredFinding } from "../core/domain/Finding";
import { findingFingerprint } from "./findingFingerprint";

/**
 * How far an ignored occurrence may move and still be the same occurrence.
 *
 * Deliberately generous. Being too generous costs one extra finding staying
 * hidden, which the user can restore in one click. Being too tight costs an
 * ignore that stops applying the first time the user types above it, and nothing
 * on screen says why.
 *
 * Only used for the **ignore** path. A review never consults it.
 */
export const IGNORE_RELOCATION_TOLERANCE = 400;

/**
 * The identity of a reviewed occurrence: same rule, same node, same exact
 * position, in the document as it is right now.
 *
 * Exact offsets are the point rather than a limitation. A review is a statement
 * about a specific span of specific text; carrying it onto a plan built from
 * different text would apply something the user never looked at, which is the
 * exact failure this identity exists to prevent.
 */
export function reviewIdentity(finding: Finding): string {
  return [
    findingFingerprint(finding),
    nodeKey(finding),
    finding.range.start,
    finding.range.end,
  ].join("@");
}

/**
 * The stable half of an ignore's identity: the rule and the node it lives in.
 *
 * Split out from the offset so an ignore can be re-anchored after the document
 * shifts, without the tolerance having to cover the whole document.
 */
export function ignoreIdentity(finding: Finding): string {
  return [findingFingerprint(finding), nodeKey(finding)].join("@");
}

/** The exact identity an ignore is stored under. */
export function ignoreEntryKey(entry: IgnoredFinding): string {
  return [entry.fingerprint, nodeKeyOf(entry.nodeIds), entry.range.start, entry.range.end].join(
    "@",
  );
}

/**
 * The occurrence key for a finding, for use as a React key or a map key.
 *
 * `Finding.id` is a per-run uuid, so it changes on every scan and cannot address
 * a stored entry. This cannot.
 */
export function occurrenceKey(finding: Finding): string {
  return `${ignoreIdentity(finding)}@${finding.range.start}`;
}

/**
 * A node set reduced to a comparable string.
 *
 * Deterministic findings from the typography engine carry `nodeIds: []` because
 * they match on a character offset in a flat text run rather than a paragraph.
 * The empty string is therefore a real value, not a missing one, and two such
 * findings are only ever told apart by their position.
 */
function nodeKey(finding: Finding): string {
  return nodeKeyOf(finding.nodeIds);
}

function nodeKeyOf(nodeIds: readonly string[]): string {
  return [...nodeIds].sort().join(",");
}

/** Whether a finding and a stored ignore describe the same occurrence. */
export function isSameIgnoredOccurrence(finding: Finding, entry: IgnoredFinding): boolean {
  if (entry.fingerprint !== findingFingerprint(finding)) return false;
  if (nodeKeyOf(entry.nodeIds) !== nodeKey(finding)) return false;
  return Math.abs(entry.range.start - finding.range.start) <= IGNORE_RELOCATION_TOLERANCE;
}

/**
 * Whether a stored review still describes the finding in front of the user.
 *
 * Exact on every component. A review that has drifted is not "probably still
 * valid" — it is a decision about text the pane can no longer show, so it is
 * expired and the user reviews again.
 */
export function isSameReviewedOccurrence(finding: Finding, identity: string): boolean {
  return identity === reviewIdentity(finding);
}
