/**
 * Stage 18 smoke-test entry points (debug scaffolding, not the Stage 21
 * orchestrator).
 *
 * The taskpane (`src/taskpane/**`) must not import `word/revisionAdapter`
 * directly (ESLint `no-restricted-imports` — mutations go through the
 * orchestrator). This module is the narrow, explicitly-labeled exception path
 * that lets a human drive the Stage 18 live smoke test from the Dashboard:
 * it owns gate enablement, demo-plan construction, and tracked application,
 * and will be superseded by the Stage 21 orchestrator.
 *
 * Boundary: word-internal plus `core/domain` only — no `ai`, no `ui`.
 */

import { v4 as uuidv4 } from "uuid";
import {
  applyChangePlanWithTracking,
  setStage01Passed,
  type ApplyWithTrackingResult,
} from "./revisionAdapter";
import { ChangeSchema, type Change } from "../core/domain/Change";
import { createChangePlan, type ChangePlan } from "../core/domain/ChangePlan";
import { getDocumentSnapshot, hashDocument } from "./documentReader";
import type { WordCapabilities } from "./capabilityProbe";

/**
 * Explicit human opt-in that flips the Stage 01 mutation gate for the smoke
 * test. Requires the capability snapshot from a fresh in-Word probe run —
 * never enable blindly.
 */
export function enableSmokeMutations(capabilities: WordCapabilities): void {
  setStage01Passed(true, capabilities);
}

export interface DemoPlan {
  plan: ChangePlan;
  summary: string[];
}

/**
 * Build a small, visible, reversible demo plan against the live document:
 * an appended smoke marker plus an uppercase tweak of the opening characters
 * when the body is non-empty. Ranges and the doc hash come from a fresh
 * snapshot so the plan is never stale at build time.
 */
export async function buildDemoChangePlan(): Promise<DemoPlan> {
  const snapshot = await getDocumentSnapshot();
  const text = snapshot.text;
  const docHash = snapshot.hash ?? hashDocument(text);
  const changes: Change[] = [];
  const summary: string[] = [];

  const marker = "[ToneForge smoke test]";
  changes.push(
    ChangeSchema.parse({
      id: uuidv4(),
      type: "insertText",
      range: { start: text.length, end: text.length },
      payload: { text: text.length === 0 ? "ToneForge smoke test." : `\n${marker}` },
      rationale: "Stage 18 smoke test marker insertion",
      reversible: true,
    }),
  );
  summary.push(`insert ${JSON.stringify(marker)} at end of document`);

  if (text.length > 0) {
    const width = Math.min(5, text.length);
    const original = text.slice(0, width);
    const upper = original.toUpperCase();
    const replacement = upper === original ? `${original}!` : upper;
    changes.push(
      ChangeSchema.parse({
        id: uuidv4(),
        type: "replaceText",
        range: { start: 0, end: width },
        payload: { text: replacement },
        rationale: "Stage 18 smoke test replacement of opening characters",
        reversible: true,
      }),
    );
    summary.push(
      `replace [0, ${width}] ${JSON.stringify(original)} with ${JSON.stringify(replacement)}`,
    );
  }

  const plan = createChangePlan(docHash, snapshot.id, changes);
  return { plan, summary };
}

/**
 * Apply any caller-built plan through the tracked adapter path. The caller
 * supplies the live document hash observed at preview time; a mismatch
 * refuses application instead of corrupting an edited document.
 */
export async function applySmokePlan(
  plan: ChangePlan,
  currentDocHash: string,
): Promise<ApplyWithTrackingResult> {
  return applyChangePlanWithTracking(plan, currentDocHash);
}
