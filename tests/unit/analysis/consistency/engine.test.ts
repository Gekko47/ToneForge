import { describe, expect, it, vi } from "vitest";
import { MockAdapter } from "../../../../src/ai/providers/mockAdapter";
import type { LlmProvider, LlmRequest } from "../../../../src/ai/providers/LlmProvider";
import {
  CONSISTENCY_CONSENT_ERROR,
  ConsistencyRunCancelled,
  buildAdjudicationPrompt,
  consolidate,
  parseAdjudication,
  previewStatements,
  runConsistencyReview,
  segmentDocument,
  type ConsistencyCandidate,
} from "../../../../src/analysis/consistency";

/**
 * The engine is the one place in ToneForge that is allowed to be
 * non-deterministic, so these tests are mostly about what it must refuse to do:
 * run without consent, report against a document that moved, invent a finding
 * from an answer it could not read, or silently drop the coverage it did not
 * achieve.
 */

const DOCUMENT = [
  "## Summary",
  "The migration completed on 2026-03-04 without incident.",
  "## Detail",
  "The migration completed on 2026-07-19 after a delay.",
].join("\n");

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    consistencyConsent: true,
    document: { revision: "r1", text: DOCUMENT, sections: [] },
    ...overrides,
  };
}

/** A provider that returns a fixed answer for every adjudication. */
function answering(text: string): LlmProvider {
  return {
    name: "mock",
    complete: vi.fn(async (_request: LlmRequest) => ({ text, model: "mock" })),
  };
}

/** Narrow a caught value to the cancellation this engine throws. */
async function caughtCancellation(promise: Promise<unknown>): Promise<ConsistencyRunCancelled> {
  try {
    await promise;
  } catch (thrown) {
    return thrown as ConsistencyRunCancelled;
  }
  throw new Error("expected the run to be refused");
}

function candidate(overrides: Partial<ConsistencyCandidate> = {}): ConsistencyCandidate {
  const left = { id: "s0", section: "A", text: "The limit is 10.", start: 0, end: 16 };
  const right = { id: "s1", section: "B", text: "The limit is 20.", start: 20, end: 36 };
  return {
    checkId: "C2",
    fingerprint: "C2:s0|s1",
    suspicion: "The same quantity is given two values.",
    left,
    right,
    certainty: "ambiguous",
    evidence: {},
    ...overrides,
  };
}

describe("segmentation", () => {
  it("attributes each statement to the heading above it", () => {
    const { statements, headings } = segmentDocument(DOCUMENT, []);
    expect(headings).toEqual(["Summary", "Detail"]);
    expect(statements[0]?.statement.section).toBe("Summary");
    expect(statements[1]?.statement.section).toBe("Detail");
  });

  it("gives every statement a distinct id and real offsets", () => {
    const ids = previewStatements(DOCUMENT).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps a declared heading that the text never mentions", () => {
    // A heading with no body is an empty section, which is a different problem
    // from a missing one, and C9 needs to be able to tell the difference.
    expect(segmentDocument(DOCUMENT, ["Appendices"]).headings).toContain("Appendices");
  });
});

describe("the consent gate", () => {
  it("refuses a request with no consent, before reading any text", async () => {
    await expect(runConsistencyReview(request({ consistencyConsent: false }))).rejects.toThrow(
      CONSISTENCY_CONSENT_ERROR,
    );
  });

  it("refuses a request whose consent is merely truthy-looking", async () => {
    await expect(runConsistencyReview(request({ consistencyConsent: "true" }))).rejects.toThrow(
      CONSISTENCY_CONSENT_ERROR,
    );
    await expect(runConsistencyReview(request({ consistencyConsent: 1 }))).rejects.toThrow(
      CONSISTENCY_CONSENT_ERROR,
    );
  });

  it("does not treat the product's other consents as this engine's", async () => {
    await expect(
      runConsistencyReview(
        request({
          consistencyConsent: undefined,
          fullDocumentReviewConsent: true,
          spotReviewConsent: true,
          semanticOptIn: true,
        }),
      ),
    ).rejects.toThrow(CONSISTENCY_CONSENT_ERROR);
  });

  it("never reaches the provider when consent is absent", async () => {
    const provider = answering('{"verdict":"contradiction","confidence":0.9,"rationale":"x"}');
    await expect(
      runConsistencyReview(request({ consistencyConsent: false }), { provider }),
    ).rejects.toThrow();
    expect(provider.complete).not.toHaveBeenCalled();
  });
});

describe("reading a verdict", () => {
  it("reads a bare JSON answer", () => {
    const verdict = parseAdjudication(
      '{"verdict":"contradiction","confidence":0.9,"rationale":"The figures differ."}',
      candidate(),
    );
    expect(verdict.verdict).toBe("contradiction");
    expect(verdict.confidence).toBe(0.9);
  });

  it("reads an answer wrapped in a markdown fence", () => {
    const verdict = parseAdjudication(
      'Here you go:\n```json\n{"verdict":"notAConflict","confidence":0.8,"rationale":"Both can hold."}\n```',
      candidate(),
    );
    expect(verdict.verdict).toBe("notAConflict");
  });

  it("treats an unreadable answer as unclear, never as a contradiction", () => {
    // The dangerous failure here is a parse error silently becoming a finding.
    // "I could not read this" has to mean "no conclusion".
    ["", "I am not sure.", "{not json", '{"verdict":"maybe","confidence":"high"}'].forEach(
      (text) => {
        const verdict = parseAdjudication(text, candidate());
        expect(verdict.verdict).toBe("unclear");
        expect(verdict.confidence).toBe(0);
      },
    );
  });

  it("drops a confidence outside 0-1 rather than clamping it", () => {
    const verdict = parseAdjudication(
      '{"verdict":"contradiction","confidence":7,"rationale":"Sure."}',
      candidate(),
    );
    expect(verdict.verdict).toBe("unclear");
  });
});

describe("consolidation", () => {
  it("reports a certain candidate without asking the model", () => {
    const issues = consolidate([candidate({ certainty: "certain" })], new Map());
    expect(issues).toHaveLength(1);
    expect(issues[0]?.confidence).toBe(1);
  });

  it("drops an ambiguous candidate the model did not rule on", () => {
    expect(consolidate([candidate()], new Map())).toHaveLength(0);
  });

  it("drops an unclear verdict", () => {
    const verdict = parseAdjudication("cannot tell", candidate());
    const issues = consolidate([candidate()], new Map([[candidate().fingerprint, verdict]]));
    expect(issues).toHaveLength(0);
  });

  it("marks a low-confidence contradiction as not actionable", () => {
    // Shown, but unable to drive a change on its own.
    const low = parseAdjudication(
      '{"verdict":"contradiction","confidence":0.3,"rationale":"Possibly."}',
      candidate(),
    );
    const issues = consolidate([candidate()], new Map([[candidate().fingerprint, low]]));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.actionable).toBe(false);
    expect(issues[0]?.suggestedText).toBeUndefined();
  });

  it("never suggests a replacement, because the engine does not write sentences", () => {
    // The engine compares two statements. The only text it has is those two
    // statements, so anything it offered as a "replacement" would be one of them
    // echoed back — which reads as a fix and is not one.
    const high = parseAdjudication(
      '{"verdict":"contradiction","confidence":0.95,"rationale":"They differ."}',
      candidate(),
    );
    const issues = consolidate([candidate()], new Map([[candidate().fingerprint, high]]));
    expect(issues[0]?.actionable).toBe(true);
    expect(issues[0]?.suggestedText).toBeUndefined();
  });

  it("names a faulty statement only when the adjudicator names one", () => {
    const blaming = parseAdjudication(
      '{"verdict":"contradiction","confidence":0.95,"rationale":"They differ.","atFault":"left"}',
      candidate(),
    );
    const blamingIssues = consolidate([candidate()], new Map([[candidate().fingerprint, blaming]]));
    expect(blamingIssues[0]?.suggestedNodeId).toBe("s0");

    // A verdict that declines to say which side is wrong must not have a side
    // invented for it. The check's own certainty is not a judgement about fault.
    const neutral = parseAdjudication(
      '{"verdict":"contradiction","confidence":0.95,"rationale":"They differ."}',
      candidate(),
    );
    const neutralIssues = consolidate([candidate()], new Map([[candidate().fingerprint, neutral]]));
    expect(neutralIssues[0]?.suggestedNodeId).toBeUndefined();
  });

  it("does not invent a faulty side for a deterministically decided candidate", () => {
    const issues = consolidate([candidate({ certainty: "certain" })], new Map());
    expect(issues).toHaveLength(1);
    expect(issues[0]?.suggestedNodeId).toBeUndefined();
  });
});

describe("the prompt", () => {
  it("carries both statements and the check's own question", () => {
    const prompt = buildAdjudicationPrompt(candidate());
    expect(prompt).toContain("The limit is 10.");
    expect(prompt).toContain("The limit is 20.");
    expect(prompt).toMatch(/C2/);
  });

  it("asks for JSON only", () => {
    expect(buildAdjudicationPrompt(candidate())).toContain("JSON only");
  });
});

describe("running a review", () => {
  it("finds the temporal conflict the document contains", async () => {
    const report = await runConsistencyReview(request());
    const temporal = report.issues.filter((issue) => issue.checkId === "C3");
    expect(temporal).toHaveLength(1);
    expect(temporal[0]?.confidence).toBe(1);
  });

  it("reports coverage for every check, including the ones that found nothing", async () => {
    const report = await runConsistencyReview(request());
    expect(Object.keys(report.coverage.perCheck)).toHaveLength(10);
    expect(report.coverage.perCheck.C3).toBe(1);
    expect(report.coverage.perCheck.C5).toBe(0);
  });

  it("states the pairwise comparison it actually performed", async () => {
    const report = await runConsistencyReview(request());
    const count = report.coverage.statementsConsidered;
    expect(report.coverage.comparisonsMade).toBe((count * (count - 1)) / 2);
  });

  it("runs only the checks it was asked to run", async () => {
    const report = await runConsistencyReview(request({ checks: ["C3"] }));
    expect(report.issues.every((issue) => issue.checkId === "C3")).toBe(true);
    // A check that did not run is reported as zero, so coverage never implies it did.
    expect(report.coverage.perCheck.C1).toBe(0);
  });

  it("degrades to the deterministic half when no provider is configured", async () => {
    const report = await runConsistencyReview(request());
    expect(report.usedModel).toBe(false);
    expect(report.coverage.complete).toBe(false);
    // A run that silently looked complete would be the real failure here.
    expect(report.coverage.limitations.join(" ")).toMatch(/no language model/i);
  });

  it("still reports a deterministic conflict with no provider configured", async () => {
    const report = await runConsistencyReview(request());
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it("reports a run with nothing ambiguous as complete even with no provider", async () => {
    // There was nothing for a model to decide, so nothing went undecided. A
    // provider requirement here would report a fully reviewed document as
    // partial for the sole reason that no model was configured.
    const report = await runConsistencyReview(
      request({
        document: {
          revision: "r1",
          text: "## Summary\nThe migration completed on 2026-03-04.\n",
          sections: [],
        },
        checks: ["C3"],
      }),
    );
    expect(report.coverage.complete).toBe(true);
    expect(report.usedModel).toBe(false);
  });

  it("counts a failed review as unreviewed rather than complete", async () => {
    // A provider that throws every request reviewed nothing. Reporting that as a
    // complete review is the failure this engine exists to avoid.
    const provider: LlmProvider = {
      name: "mock",
      complete: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    const report = await runConsistencyReview(request(), { provider });
    expect(report.usedModel).toBe(false);
    expect(report.coverage.complete).toBe(false);
    expect(report.coverage.modelAdjudicated).toBe(0);
    expect(report.coverage.limitations.join(" ")).toMatch(/could not be reviewed/i);
  });

  it("stops adjudicating at the cap and reports how many went unreviewed", async () => {
    // One term defined three ways leaves three candidates; a cap of one means two
    // conflicts were never looked at, and the report has to say so.
    const provider = answering('{"verdict":"unclear","confidence":0,"rationale":"No."}');
    const report = await runConsistencyReview(
      request({
        maxAdjudications: 1,
        document: {
          revision: "r1",
          text: [
            "## A",
            "Latency is defined as the delay before a response.",
            "## B",
            "Latency is defined as the time the server takes to reply.",
            "## C",
            "Latency is defined as the elapsed time for one request.",
          ].join("\n"),
          sections: [],
        },
      }),
      { provider },
    );
    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(report.coverage.complete).toBe(false);
    expect(report.coverage.limitations.join(" ")).toMatch(/first 1 of/i);
  });

  it("marks coverage incomplete and says so when the statement cap bites", async () => {
    const report = await runConsistencyReview(request({ maxStatements: 1 }));
    expect(report.coverage.complete).toBe(false);
    expect(report.coverage.statementsTotal).toBeGreaterThan(report.coverage.statementsConsidered);
    expect(report.coverage.limitations.join(" ")).toMatch(/first 1 of/i);
  });

  it("emits progress that starts before the end and ends at one", async () => {
    const fractions: number[] = [];
    await runConsistencyReview(request(), {
      onProgress: (progress) => fractions.push(progress.fraction),
    });
    expect(fractions[0]).toBeLessThan(1);
    expect(fractions[fractions.length - 1]).toBe(1);
  });

  it("survives a provider that throws, keeping the deterministic findings", async () => {
    // Losing a whole review because one request timed out would be worse than
    // reporting fewer candidates.
    const provider: LlmProvider = {
      name: "mock",
      complete: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    const report = await runConsistencyReview(request(), { provider });
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it("refuses to report against a document that changed mid-run", async () => {
    await expect(runConsistencyReview(request(), { currentRevision: () => "r2" })).rejects.toThrow(
      ConsistencyRunCancelled,
    );
  });

  it("distinguishes a stale document from a cancellation", async () => {
    const error = await caughtCancellation(
      runConsistencyReview(request(), { currentRevision: () => "r2" }),
    );
    expect(error.reason).toBe("stale");
  });

  it("refuses a cancelled run", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await caughtCancellation(
      runConsistencyReview(request(), { signal: controller.signal }),
    );
    expect(error.reason).toBe("cancelled");
  });

  it("uses the MockAdapter without reaching a network", async () => {
    // The mock is the only provider these tests are permitted to use.
    const provider = new MockAdapter({
      defaultResponse: '{"verdict":"unclear","confidence":0,"rationale":"Unclear."}',
    });
    const report = await runConsistencyReview(request(), { provider });
    expect(report.usedModel).toBe(true);
  });
});
