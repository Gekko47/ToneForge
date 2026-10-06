import { describe, expect, it } from "vitest";
import type { LlmProvider, LlmResponse } from "../../../../src/ai/providers/LlmProvider";
import { MockAdapter } from "../../../../src/ai/providers/mockAdapter";
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

/**
 * R2 extraction wiring: with a provider configured and
 * the run opted out of redaction, the document is
 * batched by its section hierarchy, claims are
 * extracted in two passes, and every claim's evidence
 * is proven against the document. Without the opt-out,
 * or without a provider, the run says so and compares
 * nothing.
 */
function headedRequest(overrides: Record<string, unknown> = {}) {
  return {
    consistencyConsent: true,
    document: {
      revision: "doc-r2",
      text: "## Programme\n\nThe contractor reported a six-week delay.\n\n## Quantum\n\nThe quantum is 1,250,000 USD.",
      sections: ["Programme", "Quantum"],
    },
    allowUnredacted: true,
    ...overrides,
  };
}

function rawClaim(overrides: Record<string, unknown> = {}) {
  return {
    claimClass: "FACT_ASSERTION",
    predicate: "the contractor reported a delay",
    speaker: { id: "party-contractor", name: "The Contractor" },
    adoptionStatus: "reported_party_position",
    polarity: "positive",
    evidence: { paragraphId: "p-1-0", exactText: "a six-week delay" },
    ...overrides,
  };
}

describe("R2 extraction wiring", () => {
  it("extracts and validates claims when a provider runs with the redaction opt-out", async () => {
    const provider = new MockAdapter({
      responses: {
        "six-week": JSON.stringify({ claims: [rawClaim()] }),
        "1,250,000": JSON.stringify({ claims: [] }),
      },
    });
    const report = await runConsistencyReview(headedRequest(), {
      provider,
    });
    expect(report.usedModel).toBe(true);
    expect(report.coverage.quarantinedClaims).toBe(0);
    expect(report.coverage.limitations).toContain(
      "Claims were extracted and their evidence validated, but the indexed comparison pipeline is not yet implemented (R3–R6), so no comparisons were made.",
    );
  });

  it("counts a claim whose quoted evidence is not in the document", async () => {
    const singleSection = {
      consistencyConsent: true,
      document: {
        revision: "doc-r2",
        text: "## Programme\n\nThe contractor reported a six-week delay.",
        sections: ["Programme"],
      },
      allowUnredacted: true,
    };
    const provider = new MockAdapter({
      responses: {
        "six-week": JSON.stringify({
          claims: [
            rawClaim({
              evidence: {
                paragraphId: "p-1-0",
                exactText: "a twelve-week delay",
              },
            }),
          ],
        }),
      },
    });
    const report = await runConsistencyReview(singleSection, {
      provider,
    });
    expect(report.usedModel).toBe(true);
    expect(report.coverage.quarantinedClaims).toBe(1);
  });

  it("skips extraction when the run does not opt out of redaction", async () => {
    const provider = new MockAdapter({
      responses: {
        "six-week": JSON.stringify({ claims: [rawClaim()] }),
      },
    });
    const report = await runConsistencyReview(headedRequest({ allowUnredacted: false }), {
      provider,
    });
    expect(report.usedModel).toBe(false);
    expect(report.coverage.quarantinedClaims).toBe(0);
    expect(report.coverage.limitations.join(" ")).toContain("did not opt out of redaction");
  });

  it("skips extraction when no provider is configured", async () => {
    const report = await runConsistencyReview(headedRequest());
    expect(report.usedModel).toBe(false);
    expect(report.coverage.limitations.join(" ")).toContain("No provider was configured");
  });

  it("reports the extracting phase when a provider runs", async () => {
    const phases: string[] = [];
    const provider = new MockAdapter({
      responses: {
        "six-week": JSON.stringify({ claims: [rawClaim()] }),
        "1,250,000": JSON.stringify({ claims: [] }),
      },
    });
    await runConsistencyReview(headedRequest(), {
      provider,
      onProgress: (progress) => phases.push(progress.phase),
    });
    expect(phases).toContain("extracting");
    expect(phases[phases.length - 1]).toBe("done");
  });

  it("maps a cancellation during extraction to ConsistencyRunCancelled", async () => {
    const controller = new AbortController();
    const provider: LlmProvider = {
      name: "aborting",
      complete: async (): Promise<LlmResponse> => {
        controller.abort();
        return { text: "{}", model: "aborting" };
      },
    };
    await expect(
      runConsistencyReview(headedRequest(), {
        provider,
        signal: controller.signal,
      }),
    ).rejects.toThrow(ConsistencyRunCancelled);
  });
});
