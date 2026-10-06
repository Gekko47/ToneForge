import { describe, expect, it } from "vitest";
import {
  ConsistencyRunCancelled,
  previewStatements,
  runConsistencyReview,
  segmentDocument,
} from "../../../../src/analysis/consistency/indexedEngine";

/**
 * R0 skeleton tests: the engine gate (consent first), the guards
 * (cancellation, staleness), and the honest empty report.
 */
function request(overrides: Record<string, unknown> = {}) {
  return {
    consistencyConsent: true,
    document: { revision: "r1", text: "First sentence. Second sentence.", sections: [] },
    ...overrides,
  };
}

describe("indexed engine skeleton", () => {
  it("splits text into trimmed non-empty statements", () => {
    expect(previewStatements("  First.  \n\nSecond!  ")).toEqual(["First.", "Second!"]);
    expect(previewStatements("")).toEqual([]);
  });

  it("segments with stable session ids", () => {
    const statements = segmentDocument("Alpha. Beta.", ["Intro"]);
    expect(statements.map((statement) => statement.id)).toEqual(["s-0", "s-1"]);
    expect(statements[0]?.section).toBe("Intro");
    expect(statements[0]?.index).toBe(0);
  });

  it("refuses without consent", async () => {
    await expect(
      runConsistencyReview({ document: { revision: "r1", text: "Hi.", sections: [] } }),
    ).rejects.toThrow();
  });

  it("returns an honest empty report tied to its revision", async () => {
    const report = await runConsistencyReview(request());
    expect(report.revision).toBe("r1");
    expect(report.issues).toEqual([]);
    expect(report.usedModel).toBe(false);
    expect(report.coverage.complete).toBe(false);
    expect(report.coverage.statementsTotal).toBe(2);
    expect(report.coverage.limitations.length).toBeGreaterThan(0);
  });

  it("reports progress through segmenting to done", async () => {
    const phases: string[] = [];
    await runConsistencyReview(request(), {
      onProgress: (progress) => phases.push(progress.phase),
    });
    expect(phases).toContain("segmenting");
    expect(phases[phases.length - 1]).toBe("done");
  });

  it("throws cancelled when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runConsistencyReview(request(), { signal: controller.signal })).rejects.toThrow(
      ConsistencyRunCancelled,
    );
  });

  it("throws stale when the document moved underneath the run", async () => {
    await expect(
      runConsistencyReview(request(), { currentRevision: async () => "r2" }),
    ).rejects.toThrow(ConsistencyRunCancelled);
  });

  it("marks the cancellation reason", () => {
    expect(new ConsistencyRunCancelled("cancelled").reason).toBe("cancelled");
    expect(new ConsistencyRunCancelled("stale").reason).toBe("stale");
  });
});
