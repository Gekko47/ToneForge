/**
 * The two persisted semantic records: sample evidence and review outcomes.
 *
 * Both exist to answer a question the pane cannot answer from memory — where a
 * profile was learned from, and whether a review was written — so the tests here
 * are about what survives a round trip through the store rather than about the
 * writer functions in isolation.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSemanticProfileRecord,
  loadSemanticReviewOutcomes,
  loadSemanticSampleEvidence,
  loadState,
  saveSemanticProfileRecord,
  saveSemanticReviewOutcome,
  saveSemanticSampleEvidence,
} from "../../../../src/core/state/persistence";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import { createRecord, newProfileId } from "../../../../src/core/domain/ProfileRecord";
import {
  SEMANTIC_REVIEW_OUTCOME_CAP,
  type SemanticReviewOutcome,
  type SemanticSampleEvidence,
} from "../../../../src/core/domain/SemanticReviewSession";

const NOW = "2026-01-01T00:00:00.000Z";
const SESSION_ID = "3f1b0c6e-6a54-4b1e-9c2a-0d1e2f3a4b5c";

function evidence(overrides: Partial<SemanticSampleEvidence> = {}): SemanticSampleEvidence {
  return {
    id: "5d3f8b21-7c4a-4e19-9b62-8f1a3c5d7e02",
    source: "pasted_text",
    wordCount: 412,
    sentenceCount: 19,
    paragraphCount: 6,
    capturedAt: NOW,
    sampleHash: "a1b2c3d4",
    ...overrides,
  };
}

function outcome(
  sessionId: string,
  at: string,
  kind: SemanticReviewOutcome["outcome"] = "applied",
): SemanticReviewOutcome {
  return {
    sessionId,
    profileId: "9a2c7e14-52b8-4c3d-8e1f-2b6d4a8f0c31",
    profileRevision: 1,
    outcome: kind,
    at,
    preservationPassed: true,
    selectionWordCount: 186,
  };
}

describe("semantic sample evidence and review outcomes", () => {
  let originalOffice: unknown;

  beforeEach(() => {
    originalOffice = (globalThis as { Office?: unknown }).Office;
    (globalThis as { Office?: unknown }).Office = undefined;
    window.localStorage.clear();
  });

  afterEach(() => {
    (globalThis as { Office?: unknown }).Office = originalOffice;
    window.localStorage.clear();
  });

  it("round-trips sample evidence through the store", () => {
    saveSemanticSampleEvidence(evidence());
    expect(loadSemanticSampleEvidence("5d3f8b21-7c4a-4e19-9b62-8f1a3c5d7e02")).toEqual(evidence());
  });

  it("answers null for evidence that was never recorded, rather than a default", () => {
    // "Learned before sample evidence was recorded" and "learned from an empty
    // sample" are different states, and only one of them is true.
    expect(loadSemanticSampleEvidence("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("keeps a file's name on a .txt import and drops it from a pasted sample", () => {
    saveSemanticSampleEvidence(
      evidence({ id: newProfileId(), source: "text_file", filename: "expert.txt" }),
    );
    const id = Object.keys(loadState().semanticSampleEvidence).find(
      (key) => loadState().semanticSampleEvidence[key]?.source === "text_file",
    );
    expect(loadSemanticSampleEvidence(id ?? "")?.filename).toBe("expert.txt");
  });

  it("overwrites rather than accumulating when the same sample is learned twice", () => {
    saveSemanticSampleEvidence(evidence());
    saveSemanticSampleEvidence(evidence({ wordCount: 500 }));
    expect(Object.keys(loadState().semanticSampleEvidence)).toHaveLength(1);
    expect(loadSemanticSampleEvidence("5d3f8b21-7c4a-4e19-9b62-8f1a3c5d7e02")?.wordCount).toBe(500);
  });

  it("refuses evidence carrying a source the schema does not name", () => {
    expect(() =>
      saveSemanticSampleEvidence({
        ...evidence(),
        source: "pasted",
      } as unknown as SemanticSampleEvidence),
    ).toThrow();
  });

  it("records a review outcome and reads it back oldest first", () => {
    saveSemanticReviewOutcome(outcome(SESSION_ID, "2026-01-02T00:00:00.000Z"));
    saveSemanticReviewOutcome(
      outcome("7c4a1e93-2b6d-4f81-9a05-6d3e8c1b4f27", "2026-01-01T00:00:00.000Z", "kept_original"),
    );
    expect(loadSemanticReviewOutcomes().map((entry) => entry.outcome)).toEqual([
      "kept_original",
      "applied",
    ]);
  });

  it("keeps one row per session, newest outcome winning", () => {
    saveSemanticReviewOutcome(outcome(SESSION_ID, "2026-01-01T00:00:00.000Z", "regenerated"));
    saveSemanticReviewOutcome(outcome(SESSION_ID, "2026-01-02T00:00:00.000Z"));

    const stored = loadSemanticReviewOutcomes();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.outcome).toBe("applied");
  });

  it("caps the log at the documented retention", () => {
    Array.from({ length: SEMANTIC_REVIEW_OUTCOME_CAP + 4 }, (_unused, index) => index).forEach(
      (index) => {
        saveSemanticReviewOutcome(
          outcome(
            `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
          ),
        );
      },
    );
    expect(loadSemanticReviewOutcomes()).toHaveLength(SEMANTIC_REVIEW_OUTCOME_CAP);
  });

  it("refuses an outcome whose profile revision is not a real revision", () => {
    expect(() =>
      saveSemanticReviewOutcome({
        ...outcome(SESSION_ID, NOW),
        profileRevision: 0,
      }),
    ).toThrow();
  });

  it("keeps the semantic namespace across a reload, rather than dropping it", () => {
    // The defect this phase found: `readCurrentState` hard-coded the semantic
    // namespace empty, so a profile learned with Learn Style was written and then
    // silently discarded at the next load, at every state version. Learn, reload,
    // and the tab was empty again with nothing saying why.
    const id = newProfileId();
    saveSemanticProfileRecord(
      createRecord(id, "Learned style", NOW, createEmptyProfile("Learned style"), "semantic"),
    );

    expect(loadState().semanticProfileRecords[id]).toBeDefined();
  });

  it("creates a semantic profile active by default, and inactive on request", () => {
    // Two controls the specification §11 learned-profile review requires, which
    // were one control until P1. The default preserves every existing caller.
    const active = createSemanticProfileRecord("Active", NOW);
    expect(loadState().activeSemanticProfileId).toBe(active.id);

    const inactive = createSemanticProfileRecord("Inactive", NOW, undefined, { activate: false });
    expect(loadState().activeSemanticProfileId).toBe(active.id);
    expect(loadState().semanticProfileRecords[inactive.id]).toBeDefined();
  });
});
