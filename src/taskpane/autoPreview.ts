/**
 * When a scan should produce a preview.
 *
 * The Preview button used to be the only thing that built a plan, which meant
 * a user who opened the pane and read their findings could not see what would
 * change without a second action. Auto-preview removes that gap — but only
 * where it is *safe* to do so, and the safety is not the same everywhere.
 *
 * The rule: a preview is built from a full scan, and never from a narrowed
 * one. A narrowed scan examined a few paragraphs; a plan derived from it would
 * describe changes to a document that was never read, and `applyPendingPlan`
 * would then refuse it on a hash mismatch at exactly the moment the user
 * believed they had reviewed something real. Reporting the gap instead is
 * honest and costs one button press the user chose to make themselves.
 *
 * The docHash is part of the decision, not decoration: a plan is only
 * applicable to the document it was built from, so a preview for a different
 * hash is not a preview at all.
 */

export interface PreviewDecisionInput {
  /** True when the scan examined the whole document. */
  fullScan: boolean;
  /** The document the scan read. */
  docHash: string | null;
  /** The document a preview is already held for, if any. */
  previewedDocHash: string | null;
  /** True while a preview is being built. */
  previewing: boolean;
}

export type PreviewDecision =
  { kind: "skip"; reason: string } | { kind: "preview"; docHash: string };

const NO_SCAN = "No scan has completed yet, so there is nothing to preview.";
const ALREADY = "A preview for this document is already available.";
const BUSY = "A preview is already being built.";
const NARROWED =
  "This scan examined only the paragraphs Word reported as changed, so it " +
  "cannot produce a preview of the whole document. Use Re-scan to preview.";

export function decidePreview(input: PreviewDecisionInput): PreviewDecision {
  if (input.previewing) return { kind: "skip", reason: BUSY };
  if (input.docHash === null) return { kind: "skip", reason: NO_SCAN };
  if (input.previewedDocHash === input.docHash) return { kind: "skip", reason: ALREADY };
  if (!input.fullScan) return { kind: "skip", reason: NARROWED };
  return { kind: "preview", docHash: input.docHash };
}

/**
 * Whether a status describes a full scan.
 *
 * Read from the coverage report rather than from the scan's own request: the
 * report is the one artefact that states what was examined, and it is parsed
 * at a boundary, so a caller cannot get this wrong by passing the wrong flag.
 *
 * A missing coverage report is treated as a full scan. That is the permissive
 * reading, and it is deliberate: a scan that cannot report its scope has not
 * told us it was narrow, and refusing to preview on a technicality would
 * reintroduce the button this replaces.
 */
export function isFullScan(
  coverage: { acquisition?: { incremental?: boolean } | undefined } | null,
): boolean {
  return coverage?.acquisition?.incremental !== true;
}
