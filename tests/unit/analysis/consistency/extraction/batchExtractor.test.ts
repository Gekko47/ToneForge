import { describe, expect, it } from "vitest";
import {
  LlmError,
  type LlmProvider,
  type LlmResponse,
} from "../../../../../src/ai/providers/LlmProvider";
import { MockAdapter } from "../../../../../src/ai/providers/mockAdapter";
import { buildExtractionBatches } from "../../../../../src/analysis/consistency/extraction/batch";
import { extractClaims } from "../../../../../src/analysis/consistency/extraction/batchExtractor";
import type { ConsistencyDocument } from "../../../../../src/analysis/consistency/contracts";
import { hashText } from "../../../../../src/shared/utils/text";

/**
 * R2 Pass A tests: one provider call per batch, retried
 * on transient failures only, carrying the caller's
 * AbortSignal, with malformed output rejected and
 * counted, and every claim's evidence resolved to an
 * exact, proven span of the document.
 */

const DOCUMENT: ConsistencyDocument = {
  revision: "doc-extract",
  text: "## Programme\n\nThe contractor reported a six-week delay to the accepted baseline programme.",
  sections: ["Programme"],
};

const DOCUMENT_ID = "doc-extract";

const SESSION_ID = "session-extract";

function batches() {
  return buildExtractionBatches(DOCUMENT);
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

function response(claims: Record<string, unknown>[]): string {
  return JSON.stringify({ claims });
}

function extract(provider: LlmProvider, opts: Record<string, unknown> = {}) {
  return extractClaims(
    provider,
    batches(),
    {
      documentId: DOCUMENT_ID,
      text: DOCUMENT.text,
      reviewSessionId: SESSION_ID,
    },
    { baseDelayMs: 0, maxDelayMs: 0, ...opts },
  );
}

/** A provider that fails a number of times, then succeeds. */
class FlakyProvider implements LlmProvider {
  readonly name = "flaky";
  calls = 0;
  constructor(
    private readonly failures: number,
    private readonly successText: string,
  ) {}
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    if (this.calls <= this.failures) {
      throw new LlmError("transient failure", this.name, true);
    }
    return { text: this.successText, model: this.name };
  }
}

/** A provider that always fails with a fixed error. */
class FailingProvider implements LlmProvider {
  readonly name = "failing";
  calls = 0;
  constructor(private readonly error: LlmError) {}
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    throw this.error;
  }
}

describe("Pass A local extraction", () => {
  it("returns claims whose evidence is resolved to exact offsets and hash", async () => {
    const provider = new MockAdapter({
      responses: { "six-week": response([rawClaim()]) },
    });
    const result = await extract(provider);
    expect(result.quarantined).toEqual([]);
    const claim = result.claims[0];
    expect(claim?.id).toBe("provisional-1");
    expect(claim?.reviewSessionId).toBe(SESSION_ID);
    expect(claim?.evidence.exactText).toBe("a six-week delay");
    expect(claim?.evidence.evidenceHash).toBe(hashText("a six-week delay"));
    expect(claim?.evidence.paragraphId).toBe("p-1-0");
    expect(claim?.evidence.sectionId).toBe("section-1");
    expect(claim?.evidence.sectionPath).toEqual(["Programme"]);
    const start = claim?.evidence.startOffset;
    const end = claim?.evidence.endOffset;
    expect(start).toBeTypeOf("number");
    expect(end).toBeTypeOf("number");
    if (typeof start === "number" && typeof end === "number") {
      expect(DOCUMENT.text.slice(start, end)).toBe("a six-week delay");
    }
    expect(claim?.extraction).toEqual({
      modelId: "mock",
      pass: "local",
      batchId: "batch-1",
      extractedAt: expect.any(String),
    });
  });

  it("sends one prompt per batch, keyed by the batch's own text", async () => {
    const twoSectionDocument: ConsistencyDocument = {
      revision: "doc-extract",
      text: "## A\n\nFirst claim text.\n\n## B\n\nSecond claim text.",
      sections: ["A", "B"],
    };
    const provider = new MockAdapter({
      responses: {
        "First claim text": response([
          rawClaim({
            evidence: {
              paragraphId: "p-1-0",
              exactText: "First claim text",
            },
          }),
        ]),
        "Second claim text": response([
          rawClaim({
            predicate: "the second claim",
            evidence: {
              paragraphId: "p-2-0",
              exactText: "Second claim text",
            },
          }),
        ]),
      },
    });
    const result = await extractClaims(
      provider,
      buildExtractionBatches(twoSectionDocument),
      {
        documentId: "doc-extract",
        text: twoSectionDocument.text,
        reviewSessionId: SESSION_ID,
      },
      { baseDelayMs: 0, maxDelayMs: 0 },
    );
    expect(result.claims.map((claim) => claim.id)).toEqual(["provisional-1", "provisional-2"]);
    expect(result.claims[0]?.extraction.batchId).toBe("batch-1");
    expect(result.claims[1]?.extraction.batchId).toBe("batch-2");
  });

  it("quarantines a claim whose quoted evidence is not in the cited paragraph", async () => {
    const provider = new MockAdapter({
      responses: {
        "six-week": response([
          rawClaim({
            evidence: {
              paragraphId: "p-1-0",
              exactText: "a twelve-week delay",
            },
          }),
        ]),
      },
    });
    const result = await extract(provider);
    expect(result.claims).toEqual([]);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0]?.claimId).toBe("provisional-1");
    expect(result.quarantined[0]?.reason).toContain("not found in paragraph p-1-0");
  });

  it("quarantines a claim that cites a paragraph outside its batch", async () => {
    const provider = new MockAdapter({
      responses: {
        "six-week": response([
          rawClaim({
            evidence: {
              paragraphId: "p-9-9",
              exactText: "a six-week delay",
            },
          }),
        ]),
      },
    });
    const result = await extract(provider);
    expect(result.claims).toEqual([]);
    expect(result.quarantined[0]?.reason).toContain("is not in batch batch-1");
  });

  it("rejects malformed JSON output and counts the rejection", async () => {
    const provider = new MockAdapter({ defaultResponse: "not json" });
    const result = await extract(provider);
    expect(result.claims).toEqual([]);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0]?.claimId).toBe("batch-1");
    expect(result.quarantined[0]?.reason).toContain("not valid JSON");
  });

  it("rejects output that does not match the extraction schema", async () => {
    const provider = new MockAdapter({
      defaultResponse: JSON.stringify({ claims: [{ claimClass: "NOT_A_CLASS" }] }),
    });
    const result = await extract(provider);
    expect(result.claims).toEqual([]);
    expect(result.quarantined[0]?.claimId).toBe("batch-1");
    expect(result.quarantined[0]?.reason).toContain("did not match the extraction schema");
  });

  it("accepts a batch whose model returned no claims", async () => {
    const provider = new MockAdapter({
      defaultResponse: JSON.stringify({ claims: [] }),
    });
    const result = await extract(provider);
    expect(result.claims).toEqual([]);
    expect(result.quarantined).toEqual([]);
  });

  it("retries a transient provider failure and then succeeds", async () => {
    const provider = new FlakyProvider(2, response([rawClaim()]));
    const result = await extract(provider);
    expect(result.claims).toHaveLength(1);
    expect(provider.calls).toBe(3);
  });

  it("does not retry a non-retryable failure", async () => {
    const provider = new FailingProvider(new LlmError("hard failure", "failing", false));
    await expect(extract(provider)).rejects.toThrow("hard failure");
    expect(provider.calls).toBe(1);
  });

  it("does not retry a non-LlmError failure", async () => {
    const provider: LlmProvider = {
      name: "broken",
      complete: async (): Promise<LlmResponse> => {
        throw new Error("network down");
      },
    };
    await expect(extract(provider)).rejects.toThrow("network down");
  });

  it("passes the abort signal to the provider and fails fast", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new MockAdapter({
      responses: { "six-week": response([rawClaim()]) },
    });
    await expect(extract(provider, { signal: controller.signal })).rejects.toThrow(LlmError);
  });

  it("stops at the batch boundary when the signal aborts mid-run", async () => {
    const controller = new AbortController();
    let calls = 0;
    const provider: LlmProvider = {
      name: "aborting",
      complete: async (): Promise<LlmResponse> => {
        calls += 1;
        controller.abort();
        return { text: response([]), model: "aborting" };
      },
    };
    const twoSectionDocument: ConsistencyDocument = {
      revision: "doc-extract",
      text: "## A\n\nFirst.\n\n## B\n\nSecond.",
      sections: ["A", "B"],
    };
    await expect(
      extractClaims(
        provider,
        buildExtractionBatches(twoSectionDocument),
        {
          documentId: "doc-extract",
          text: twoSectionDocument.text,
          reviewSessionId: SESSION_ID,
        },
        {
          baseDelayMs: 0,
          maxDelayMs: 0,
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow(LlmError);
    expect(calls).toBe(1);
  });

  it("uses the caller's clock for extraction timestamps", async () => {
    const provider = new MockAdapter({
      responses: { "six-week": response([rawClaim()]) },
    });
    const result = await extract(provider, {
      now: () => "2026-10-06T00:00:00.000Z",
    });
    expect(result.claims[0]?.extraction.extractedAt).toBe("2026-10-06T00:00:00.000Z");
  });
});
