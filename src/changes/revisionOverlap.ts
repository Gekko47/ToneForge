/**
 * Pure overlap assessment between a proposed change and the tracked revisions
 * the inspection reader returned.
 *
 * **Why this is a separate module.** The apply path needs to refuse a change that
 * lands on an unaccepted revision authored by someone else, and it needs to
 * recognise its own revision as already applied. That decision must be testable
 * without an Office host, and it must never import one: `changes/` stays pure
 * (`core/domain` only), which is what makes the rules here unit-testable.
 *
 * The coordinate space is raw `body.text` offsets (ADR-0144). A revision's own
 * offsets come from `TrackedChange.getRange()` and may not be body-relative;
 * when they are not, the matcher degrades to node identity and, when that is
 * inconclusive, refuses — the conservative direction the spec asks for.
 */

import { TONE_FORGE_REVISION_AUTHOR, type Change, type TrackedRevision } from "../core/domain";

export type RevisionOverlap =
  | { kind: "none" }
  | { kind: "own"; revision: TrackedRevision }
  | { kind: "foreign"; revision: TrackedRevision }
  | { kind: "unknown"; reason: string };

/**
 * Half-open interval overlap: `[aStart, aEnd)` meets `[bStart, bEnd)` iff
 * `aStart < bEnd && bStart < aEnd`.
 *
 * Half-open is deliberate. Two changes that share only a boundary — one ends at
 * 40, the next starts at 40 — are adjacent, not overlapping; treating the shared
 * character as a collision would refuse a plan that touches nothing the other
 * wrote. A zero-width insertion at position `p` overlaps any range that contains
 * `p`, because a zero-width insert is a point, not an interval.
 */
function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  if (aStart === aEnd) return bStart <= aStart && aStart < bEnd;
  if (bStart === bEnd) return aStart <= bStart && bStart < aEnd;
  return aStart < bEnd && bStart < aEnd;
}

function targetIdentity(change: Change): string | null {
  const target = change.range.target;
  if (target === undefined) return null;
  if (target.kind === "paragraph") {
    const nodeId = target.nodeId ?? "";
    const structuralPath = target.structuralPath ?? "";
    if (nodeId || structuralPath) return `paragraph:${nodeId || structuralPath}`;
  }
  return null;
}

function revisionIdentity(revision: TrackedRevision): string | null {
  const target = revision.target;
  if (target === undefined) return null;
  if (target.kind === "paragraph") {
    const nodeId = target.nodeId ?? "";
    const structuralPath = target.structuralPath ?? "";
    if (nodeId || structuralPath) return `paragraph:${nodeId || structuralPath}`;
  }
  return null;
}

function classifyByAuthor(revision: TrackedRevision): RevisionOverlap {
  return revision.author === TONE_FORGE_REVISION_AUTHOR
    ? { kind: "own", revision }
    : { kind: "foreign", revision };
}

/**
 * Assess whether a proposed change overlaps any existing tracked revision.
 *
 * Order of decisions:
 * 1. No overlapping revision → `none`. Safe to apply.
 * 2. Overlapping revision authored by `ToneForge` → `own`. Already applied; the
 *    plan is idempotent against its own revisions, but re-applying would be a
 *    second write of the same correction, so it is refused as such.
 * 3. Overlapping revision by any other author → `foreign`. The document carries
 *    someone else's unaccepted edit over the target; writing would risk
 *    discarding it.
 * 4. Offsets unreadable on both sides and node identity inconclusive →
 *    `unknown`. The host did not give enough to decide; the apply path fails
 *    closed rather than guess.
 */
export function assessRevisionOverlap(
  change: Change,
  revisions: readonly TrackedRevision[],
): RevisionOverlap {
  const changeStart = change.range.start;
  const changeEnd = change.range.end;
  const changeId = targetIdentity(change);

  for (const revision of revisions) {
    const revisionRange = revision.range;
    const revisionId = revisionIdentity(revision);

    const offsetsAvailable = revisionRange !== null;
    if (offsetsAvailable) {
      const overlaps = intervalsOverlap(
        changeStart,
        changeEnd,
        revisionRange.start,
        revisionRange.end,
      );
      if (overlaps) return classifyByAuthor(revision);
      continue;
    }

    /*
     * The host did not serve this revision's offsets. Fall back to node
     * identity: a paragraph-unit change on the same node as a revision is
     * overlapping, because the revision sits inside the paragraph that is
     * about to be rewritten. Text containment is not used on its own — two
     * different paragraphs can carry the same phrase, and treating identical
     * text as the same target is exactly the error the identity check exists
     * to prevent.
     */
    if (changeId !== null && revisionId !== null && changeId === revisionId) {
      return classifyByAuthor(revision);
    }
  }

  /*
   * A revision whose offsets are missing cannot be assessed by position.
   * Return unknown when either identity is null (cannot determine overlap);
   * return none when both identities are known and differ (different target).
   * The adapter inspects the returned `unknown` reason before refusing, so a
   * plan with no candidates at all still reaches `none` here.
   */
  const hasUnresolved = revisions.some((revision) => {
    if (revision.range !== null) return false;
    if (changeId === null) return true;
    const revId = revisionIdentity(revision);
    if (revId === null) return true;
    return false;
  });
  if (hasUnresolved) {
    return {
      kind: "unknown",
      reason:
        "A tracked revision's offsets are unavailable and its node identity cannot confirm or rule out overlap with the change target",
    };
  }

  return { kind: "none" };
}
