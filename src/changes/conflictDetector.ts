/**
 * Pure conflict detection for generated change plans.
 *
 * Conflicts are reported without dropping either change. Resolution is left to
 * the safe-application stage so reviewers can inspect every proposed edit.
 */

import type { Change, ChangeType } from "../core/domain/Change";

const STYLE_TYPES: readonly ChangeType[] = ["applyStyle"];
const DIRECT_FORMAT_TYPES: readonly ChangeType[] = [
  "setCharacterFormat",
  "resetCharacterFormatting",
  "setParagraphFormat",
];

function rangesOverlap(left: Change["range"], right: Change["range"]): boolean {
  const leftIsEmpty = left.start === left.end;
  const rightIsEmpty = right.start === right.end;
  if (leftIsEmpty && rightIsEmpty) return left.start === right.start;
  return left.start < right.end && right.start < left.end;
}

function sameRange(left: Change["range"], right: Change["range"]): boolean {
  return left.start === right.start && left.end === right.end;
}

function isStyleChange(change: Change): boolean {
  return STYLE_TYPES.includes(change.type);
}

function isDirectFormatChange(change: Change): boolean {
  return DIRECT_FORMAT_TYPES.includes(change.type);
}

function styleDirectContradiction(left: Change, right: Change): boolean {
  return (
    (isStyleChange(left) && isDirectFormatChange(right)) ||
    (isDirectFormatChange(left) && isStyleChange(right))
  );
}

/** Return stable, human-readable conflict descriptions for a change list. */
export function detectConflicts(changes: readonly Change[]): string[] {
  const conflicts: string[] = [];

  changes.forEach((left, leftIndex) => {
    changes.slice(leftIndex + 1).forEach((right) => {
      if (!rangesOverlap(left.range, right.range)) return;

      const reasons: string[] = [];
      if (sameRange(left.range, right.range) && left.type !== right.type) {
        reasons.push(`same range has ${left.type} and ${right.type} changes`);
      }
      if (styleDirectContradiction(left, right)) {
        reasons.push("style and direct-format changes contradict each other");
      }
      if (reasons.length === 0) {
        reasons.push("overlapping ranges require review");
      }

      conflicts.push(`Changes ${left.id} and ${right.id} conflict: ${reasons.join("; ")}.`);
    });
  });

  return conflicts;
}
