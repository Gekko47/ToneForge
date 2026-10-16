/**
 * The apply concern classifier (D6, applied to the engine's verdict).
 *
 * The gate tests pin what a given pair of booleans does; this file pins how the
 * engine's result becomes that pair, because the defect was in the mapping: a
 * model-reported meaning flag — `actionable` false with `pass` true — was folded
 * into the *hard* preservation flag and disabled Apply with no override, while
 * the acknowledgement checkbox the same warnings rendered could not re-enable it.
 */

import { describe, expect, it } from "vitest";

import { validatePreservation } from "../../../../src/analysis/semantic/preservationValidator";
import type { SemanticReviewResult } from "../../../../src/analysis/semantic/contracts";
import { applyConcernFor } from "../../../../src/taskpane/semantic/applyConcern";
import {
  PRESERVATION_BASE_PARAGRAPH,
  QUALIFIER_PRESERVATION_CASES,
} from "../../../fixtures/expertProse";

const BASE = PRESERVATION_BASE_PARAGRAPH;

const ALL_PRESERVED = {
  qualificationPreserved: true,
  attributionPreserved: true,
  causationPreserved: true,
  responsibilityPreserved: true,
  certaintyPreserved: true,
} as const;

/** The same result with the proposal absent, as when the model proposed nothing. */
function withoutProposal(overrides: Partial<SemanticReviewResult> = {}): SemanticReviewResult {
  const { proposedRevision: _dropped, ...rest } = result(overrides);
  return rest;
}

function result(overrides: Partial<SemanticReviewResult> = {}): SemanticReviewResult {
  return {
    reviewSessionId: "session",
    runId: "run",
    stageTimings: {},
    profileId: "11111111-1111-4111-8111-111111111111",
    profileRevision: 1,
    assessment: {} as unknown as SemanticReviewResult["assessment"],
    rationale: "rationale",
    proposedRevision: "a faithful restyle",
    preservation: validatePreservation(BASE, BASE),
    meaningPreservation: { ...ALL_PRESERVED },
    actionable: true,
    providerMetadata: { provider: "openrouter", model: "m", latencyMs: 1, attempt: 1 },
    selectionAnchor: {
      documentId: "doc",
      nodeIds: [],
      startOffset: 0,
      endOffset: BASE.length,
      selectedText: BASE,
      selectionHash: "hash",
      capturedAt: "2026-10-16T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("applyConcernFor", () => {
  it("calls a clean proposal clean", () => {
    expect(applyConcernFor(result())).toEqual({ hard: false, acknowledgementRequired: false });
  });

  it("asks for one acknowledgement when the validator raised a soft warning", () => {
    const softCase = QUALIFIER_PRESERVATION_CASES[0]!;
    const soft = validatePreservation(softCase.original, softCase.proposed);
    expect(soft.pass).toBe(true);
    expect(soft.requiresAcknowledgement).toBe(true);

    expect(applyConcernFor(result({ preservation: soft }))).toEqual({
      hard: false,
      acknowledgementRequired: true,
    });
  });

  it("treats a model-reported meaning flag as soft, not a hard block", () => {
    expect(
      applyConcernFor(
        result({
          actionable: false,
          meaningPreservation: { ...ALL_PRESERVED, qualificationPreserved: false },
        }),
      ),
    ).toEqual({ hard: false, acknowledgementRequired: true });
  });

  it("treats a factual difference as hard, with no override", () => {
    const moved = validatePreservation(BASE, BASE.replace("30 June 2025", "18 July 2025"));
    expect(moved.pass).toBe(false);

    expect(applyConcernFor(result({ preservation: moved, actionable: false }))).toEqual({
      hard: true,
      acknowledgementRequired: false,
    });
  });

  it("treats a revision written for another span as hard", () => {
    // `actionable` false with a clean report and no meaning flag is the span case.
    expect(applyConcernFor(result({ actionable: false }))).toEqual({
      hard: true,
      acknowledgementRequired: false,
    });
  });

  it("has nothing to block and nothing to apply when the model proposed nothing", () => {
    expect(applyConcernFor(withoutProposal({ actionable: false }))).toEqual({
      hard: false,
      acknowledgementRequired: false,
    });
  });
});
