/**
 * Pure selection-to-plan pipeline for the Stage 18 smoke panel.
 *
 * No Office, no LLM, no React imports — fully unit-testable. The SmokePanel
 * component supplies the live snapshot/selection/profile; this module turns
 * them into a previewable `ChangePlan` whose ranges are body-relative.
 *
 * Selection locating rule: the selection text must occur exactly once in the
 * body text. Zero matches means the document changed under us; multiple
 * matches are ambiguous. Both cases return an error instead of guessing —
 * guessing would silently edit the wrong text.
 */

import { findTypographyIssues } from "../../rules/typography";
import { findHouseStyleIssues } from "../../rules/houseStyle";
import { planChanges } from "../../changes/planner";
import type { ChangePlan } from "../../core/domain/ChangePlan";
import type { Finding } from "../../core/domain/Finding";
import type { StyleProfile } from "../../core/domain/StyleProfile";
import { hashDocument } from "../../word/documentReader";

export interface SelectionLocation {
  start: number;
}

export function locateSelectionOffset(
  bodyText: string,
  selectionText: string,
): { offset: SelectionLocation } | { error: string } {
  if (selectionText.length === 0) {
    return { error: "Select some text first — the selection is empty." };
  }
  const first = bodyText.indexOf(selectionText);
  if (first === -1) {
    return {
      error: "Selection text was not found in the document body — re-select and try again.",
    };
  }
  if (bodyText.indexOf(selectionText, first + 1) !== -1) {
    return {
      error:
        "Selection text occurs more than once in the document — select uniquely identifiable text.",
    };
  }
  return { offset: { start: first } };
}

export interface SelectionPlanInput {
  bodyText: string;
  selectionText: string;
  profile: StyleProfile;
  docHash: string;
  baseDocId: string;
}

export interface SelectionPlan {
  plan: ChangePlan;
  findings: Finding[];
  selectionStart: number;
}

/**
 * Run the active profile's deterministic rules over the selection and plan
 * the resulting findings with body-relative ranges. Semantic (LLM) findings
 * are deliberately out of scope for this smoke path — no network, no opt-in.
 */
export function buildSelectionChangePlan(
  input: SelectionPlanInput,
): { plan: SelectionPlan } | { error: string } {
  const located = locateSelectionOffset(input.bodyText, input.selectionText);
  if ("error" in located) return located;
  const selectionStart = located.offset.start;

  const selectionFindings: Finding[] = [
    ...findTypographyIssues({ text: input.selectionText, rules: input.profile.typography }),
    ...findHouseStyleIssues({ text: input.selectionText, rules: input.profile.houseStyle }),
  ];
  const findings = selectionFindings.map((finding) => ({
    ...finding,
    range: {
      ...finding.range,
      start: finding.range.start + selectionStart,
      end: finding.range.end + selectionStart,
    },
  }));

  const plan = planChanges({
    findings,
    docHash: input.docHash,
    baseDocId: input.baseDocId,
  });
  return { plan: { plan, findings, selectionStart } };
}

/** Fallback hash when a snapshot carries none. */
export function snapshotHashOrCompute(text: string, hash: string | undefined): string {
  return hash ?? hashDocument(text);
}
