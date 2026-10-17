/** Pure validation and live-state matching for change-level preconditions. */

import type { Change, FormattingStateSchema } from "../core/domain/Change";
import { stripParagraphMark } from "../shared/utils/text";
import type { z } from "zod";

type ExpectedFormatting = z.infer<typeof FormattingStateSchema>;

export interface TargetState {
  text?: string;
  nodeId?: string;
  styleName?: string;
  formatting?: ExpectedFormatting;
}

export function validateChangePreconditions(changes: readonly Change[]): string[] {
  const problems: string[] = [];
  changes.forEach((change) => {
    if (change.precondition === undefined) {
      problems.push(`Change ${change.id} has no verifiable target precondition`);
      return;
    }
    if (change.range.unit === "paragraph" && change.precondition.kind !== "node") {
      problems.push(`Change ${change.id} paragraph target requires a node precondition`);
    }
    if (change.type === "insertText" && change.precondition.kind !== "text") {
      problems.push(`Change ${change.id} insertText requires a text precondition`);
    }
    /*
     * The text-precondition rule is scoped to *character* units, and it has to be.
     *
     * Read together with the paragraph rule above, the unscoped version made a
     * paragraph-unit `replaceText` impossible to plan: the first rule demands a
     * node precondition and the second demands a text one, and a single
     * precondition cannot be both. Nothing in the repository produced that shape,
     * so the contradiction stayed invisible until the semantic apply path needed
     * it — and D11's *preferred* target is exactly that shape, because
     * `Paragraph.getRange("Whole")` is the only text write available on every Word
     * host.
     *
     * The split follows what each unit can actually be checked against: for a
     * character range the live check is the text at those offsets, and for a
     * paragraph the live check is the paragraph itself — its id, its text, its
     * formatting — which `verifyLivePrecondition` already reads. The check is not
     * weakened for the deterministic path: character-unit changes are unaffected,
     * and a paragraph-unit change now has to name the node it means.
     */
    if (
      (change.type === "replaceText" || change.type === "deleteRange") &&
      change.range.unit !== "paragraph" &&
      change.precondition.kind !== "text"
    ) {
      problems.push(`Change ${change.id} text mutation requires a text precondition`);
    }
  });
  return problems;
}

export function matchesChangePrecondition(
  change: Change,
  state: TargetState,
): { matches: boolean; reason?: string } {
  const precondition = change.precondition;
  if (precondition === undefined) return { matches: false, reason: "missing precondition" };
  if (precondition.kind === "text") {
    return state.text === precondition.expectedText
      ? { matches: true }
      : {
          matches: false,
          reason: `expected text ${JSON.stringify(precondition.expectedText)}, found ${JSON.stringify(state.text ?? "")}`,
        };
  }
  if (precondition.kind === "node") {
    if (state.nodeId !== precondition.nodeId) {
      return {
        matches: false,
        reason: `expected node ${precondition.nodeId}, found ${state.nodeId ?? "unresolved"}`,
      };
    }
    if (precondition.expectedText !== undefined) {
      /*
       * Compared with the trailing paragraph mark stripped, because the two sides
       * are read from different host APIs and describe the same paragraph.
       *
       * A `node` precondition states the text the paragraph is expected to hold.
       * For the semantic apply path that text is the *selection* (which normally
       * omits the paragraph mark), while the live value is `Paragraph.text` (which
       * carries it). `word/selectionScope` already strips the mark to decide a
       * selection is a whole paragraph; comparing the raw strings here re-read
       * that same mark as a change and refused every whole-paragraph write on an
       * untouched document. Stripping only one trailing mark keeps the guard: a
       * genuine edit changes the text in a way no mark removal can hide.
       *
       * Unread live text is still a mismatch, so a host that served no `text`
       * fails closed rather than matching by omission.
       */
      const liveText = state.text;
      if (
        liveText === undefined ||
        stripParagraphMark(liveText) !== stripParagraphMark(precondition.expectedText)
      ) {
        return { matches: false, reason: "target node text changed" };
      }
    }
    if (
      precondition.expectedStyleName !== undefined &&
      state.styleName !== precondition.expectedStyleName
    ) {
      return { matches: false, reason: "target node style changed" };
    }
    if (precondition.expectedFormatting !== undefined) {
      return matchesFormatting(precondition.expectedFormatting, state.formatting);
    }
  }
  return { matches: true };
}

function matchesFormatting(
  expected: ExpectedFormatting,
  actual: ExpectedFormatting | undefined,
): { matches: boolean; reason?: string } {
  if (actual === undefined) return { matches: false, reason: "formatting state unavailable" };
  const mismatches = Object.entries(expected).filter(
    ([key, value]) => value !== undefined && actual[key as keyof ExpectedFormatting] !== value,
  );
  return mismatches.length === 0
    ? { matches: true }
    : {
        matches: false,
        reason: `formatting changed: ${mismatches.map(([key]) => key).join(", ")}`,
      };
}
