/** Pure validation and live-state matching for change-level preconditions. */

import type { Change, FormattingStateSchema } from "../core/domain/Change";
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
    if (
      (change.type === "replaceText" || change.type === "deleteRange") &&
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
    if (precondition.expectedText !== undefined && state.text !== precondition.expectedText) {
      return { matches: false, reason: "target node text changed" };
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
