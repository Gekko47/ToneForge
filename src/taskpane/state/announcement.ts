import type { DocumentObserverStatus } from "../../word/documentObserver";

/**
 * One sentence per settled Dashboard event, in the user's terms.
 *
 * The Dashboard has three independent message sources — the document observer,
 * the apply path, and the consistency review — and before this existed each of
 * them rendered its own `role="status"` element. A scan that finished while an
 * apply refusal was still on screen produced two live regions updating in the
 * same tick, and a screen reader read them in whatever order the DOM happened
 * to settle rather than in the order they happened. `useAnnouncement` already
 * solved the interruption half of that problem; this is the other half, deciding
 * which of several simultaneous messages is the one worth speaking.
 *
 * Pure, so the priority order is testable without rendering anything. Nothing
 * here decides *whether* an event happened — that is the caller's state — only
 * which sentence a settled state should produce.
 */

export type ScanPhase = DocumentObserverStatus["phase"] | "notStarted";

export interface AnnouncementInput {
  scanPhase: ScanPhase;
  findingCount: number;
  /** A scan error, if the observer reported one. */
  error: string | null;
  /** The result or refusal from the last apply attempt. */
  applyMessage: string | null;
  /** The blocker or outcome from the consistency review. */
  reviewMessage: string | null;
  /** Set when the Word host cannot be reached at all. */
  hostUnavailable: boolean;
}

function scanSentence(scanPhase: ScanPhase, findingCount: number): string {
  switch (scanPhase) {
    case "scanning":
      return "Scanning the document.";
    case "fresh":
      return findingCount === 1
        ? "Scan complete. 1 finding."
        : `Scan complete. ${findingCount} findings.`;
    case "clean":
      return "Scan complete. No findings.";
    case "notStarted":
    default:
      // Nothing has happened yet, so there is nothing to say. Announcing
      // "not scanned" on mount would be the pane talking over the user's
      // first action of the session.
      return "";
  }
}

/**
 * The single sentence a settled state should announce, or null to say nothing.
 *
 * Priority is error first, then the two things the user just pressed a button
 * for, then the background scan. A scan running in the background is the least
 * urgent thing the pane can say, so it never displaces an error or a result —
 * it only speaks when nothing else has.
 */
export function deriveAnnouncement(input: AnnouncementInput): string | null {
  if (input.hostUnavailable) {
    return "Word is not reachable, so the document cannot be read. Open the document in Word and try again.";
  }
  if (input.error !== null && input.error.length > 0) {
    return `Scan failed: ${input.error}`;
  }
  // The review message outranks the apply message because the two are not
  // simultaneous in practice: an apply result is a terminal outcome the user has
  // already seen by the time they navigate to the AI Review page, while a review
  // blocker is what is on screen in front of them when it is set. If both were
  // somehow set, the thing blocking the current view is the one worth speaking.
  if (input.reviewMessage !== null && input.reviewMessage.length > 0) {
    return input.reviewMessage;
  }
  if (input.applyMessage !== null && input.applyMessage.length > 0) {
    return input.applyMessage;
  }
  const scan = scanSentence(input.scanPhase, input.findingCount);
  return scan.length > 0 ? scan : null;
}
