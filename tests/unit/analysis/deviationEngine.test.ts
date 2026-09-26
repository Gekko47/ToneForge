import { describe, it, expect, vi, afterEach } from "vitest";

import { detectSemanticDeviations } from "../../../src/analysis/deviationEngine";
import { createLlmRegistry } from "../../../src/ai/providers/registry";
import { MockAdapter } from "../../../src/ai/providers/mockAdapter";
import { withSemanticHelpers } from "../../../src/ai/providers/LlmProvider";
import type { LlmSemanticProvider } from "../../../src/ai/providers/LlmProvider";
import { LlmError } from "../../../src/ai/providers/LlmProvider";
import { FindingSchema } from "../../../src/core/domain/Finding";
import { DocumentNodeSchema } from "../../../src/core/domain/DocumentSnapshot";
import { SAMPLE_PROFILE } from "../../fixtures/sampleDocs";
import { logger } from "../../../src/shared/utils/logger";
import type { StyleProfile } from "../../../src/core/domain/StyleProfile";

const PROFILE = SAMPLE_PROFILE as unknown as StyleProfile;

/**
 * A one-node document the anchors below are quoted from.
 *
 * The engine resolves the model's quote against these nodes, so a test that
 * wants an actionable finding must quote text that is actually here — which is
 * the whole point of the change.
 */
const TARGET = "Some target text here.";
const NODES = [
  DocumentNodeSchema.parse({
    nodeId: "n1",
    type: "paragraph",
    text: TARGET,
    editable: true,
    includedInGovernance: true,
    sourcePath: "body/n1",
    sourceRange: { nodeId: "n1", startOffset: 0, endOffset: TARGET.length },
  }),
];

function mockRegistryWith(responseText: string) {
  const mock = withSemanticHelpers(new MockAdapter({ defaultResponse: responseText }));
  return { registry: mock, mock };
}

function detect(registry: LlmSemanticProvider, text = TARGET) {
  return detectSemanticDeviations(text, PROFILE, { includeRawText: true, registry }, NODES);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detectSemanticDeviations", () => {
  it("anchors a finding to a verified span and makes it plannable", async () => {
    const { registry } = mockRegistryWith(
      JSON.stringify([
        { deviation: "Too casual", severity: "medium", suggestion: "Use formal tone", anchor: "target text" },
        {
          deviation: "Passive voice",
          severity: "high",
          suggestion: "Use active voice",
          anchor: "text here.",
        },
      ]),
    );

    const findings = await detect(registry);

    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(() => FindingSchema.parse(finding)).not.toThrow();
      expect(finding.kind).toBe("semantic");
      expect(finding.source).toBe("ai");
      expect(finding.risk).toBe("medium");
      expect(finding.category).toBe("semantic-deviation");
      expect(finding.confidence).toBeLessThan(1);
    }
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toBe("Use formal tone");
    expect(findings[0]?.evidence).toBe("Too casual");
    expect(findings[1]?.severity).toBe("error");
  });

  it("reports the node id and a document-absolute range for an anchored finding", async () => {
    // A node-relative offset would point into whatever text happens to sit there
    // in a different document.
    const { registry } = mockRegistryWith(
      JSON.stringify([
        { deviation: "D", severity: "low", suggestion: "S", anchor: "target" },
      ]),
    );

    const finding = (await detect(registry))[0];
    expect(finding?.nodeIds).toEqual(["n1"]);
    expect(finding?.range).toEqual({ start: 5, end: 11, unit: "character" });
  });

  it("keeps an anchored finding advisory about approval, because it is still AI output", async () => {
    const { registry } = mockRegistryWith(
      JSON.stringify([{ deviation: "D", severity: "high", suggestion: "S", anchor: "target" }]),
    );
    const finding = (await detect(registry))[0];
    expect(finding?.actionable).toBe(true);
    expect(finding?.source).toBe("ai");
    expect(finding?.risk).toBe("medium");
  });

  it("carries the quoted anchor as the exact precondition for the change", async () => {
    // If the document no longer contains the quote, the plan must be refused
    // rather than applied blind.
    const { registry } = mockRegistryWith(
      JSON.stringify([{ deviation: "D", severity: "high", suggestion: "S", anchor: "target" }]),
    );
    const finding = (await detect(registry))[0];
    expect(finding?.actual).toBe("target");
    expect(finding?.expected).toBe("S");
  });

  it("keeps a finding advisory and states why when the anchor is not in the document", async () => {
    // A model that paraphrased. The refusal is the finding's `advisoryReason`, so
    // the user sees why it cannot be acted on rather than just "cannot be acted on".
    const { registry } = mockRegistryWith(
      JSON.stringify([
        { deviation: "D", severity: "high", suggestion: "S", anchor: "not in the document" },
      ]),
    );

    const finding = (await detect(registry))[0];
    expect(finding?.actionable).toBe(false);
    expect(finding?.status).toBe("deferred");
    expect(finding?.nodeIds).toEqual([]);
    expect(finding?.advisoryReason).toMatch(/does not appear in the document/i);
  });

  it("keeps a finding advisory when the anchor is ambiguous", async () => {
    const ambiguous = DocumentNodeSchema.parse({
      nodeId: "n1",
      type: "paragraph",
      text: "the data is stored, and the data is lost",
      editable: true,
      includedInGovernance: true,
      sourcePath: "body/n1",
      sourceRange: { nodeId: "n1", startOffset: 0, endOffset: 39 },
    });
    const { registry } = mockRegistryWith(
      JSON.stringify([{ deviation: "D", severity: "high", suggestion: "S", anchor: "the data" }]),
    );

    const finding = (
      await detectSemanticDeviations(
        "the data is stored, and the data is lost",
        PROFILE,
        { includeRawText: true, registry },
        [ambiguous],
      )
    )[0];
    expect(finding?.actionable).toBe(false);
    expect(finding?.advisoryReason).toMatch(/appears 2 times/i);
  });

  it("keeps every finding advisory when no nodes were acquired", async () => {
    // What happens when the caller has no acquired document to verify against.
    const { registry } = mockRegistryWith(
      JSON.stringify([{ deviation: "D", severity: "high", suggestion: "S", anchor: "target" }]),
    );
    const finding = (
      await detectSemanticDeviations(TARGET, PROFILE, { includeRawText: true, registry }, [])
    )[0];
    expect(finding?.actionable).toBe(false);
    expect(finding?.advisoryReason).toBeTruthy();
  });

  it("maps severity low to info", async () => {
    const { registry } = mockRegistryWith(
      JSON.stringify([{ deviation: "Minor", severity: "low", suggestion: "Tweak", anchor: "target" }]),
    );

    const findings = await detect(registry);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
  });

  it("throws on invalid JSON", async () => {
    const { registry } = mockRegistryWith("not json at all {{{");

    await expect(detect(registry)).rejects.toThrow("not valid JSON");
  });

  it("throws when the response is not a JSON array", async () => {
    const { registry } = mockRegistryWith(JSON.stringify({ deviation: "x" }));

    await expect(detect(registry)).rejects.toThrow("must be a JSON array");
  });

  it("skips schema-invalid entries instead of failing", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { registry } = mockRegistryWith(
      JSON.stringify([
        { deviation: "Good one", severity: "medium", suggestion: "Fix it", anchor: "target" },
        // No anchor: a deviation described without a quote has no addressable
        // target, so it describes nothing the product could act on.
        { deviation: "Unanchored", severity: "medium", suggestion: "Fix it" },
        { deviation: "", severity: "medium", suggestion: "Missing deviation text", anchor: "x" },
        { severity: "high", suggestion: "Missing deviation field", anchor: "x" },
      ]),
    );

    const findings = await detect(registry);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toBe("Good one");
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping invalid semantic deviation entry",
      expect.objectContaining({ issues: expect.any(Array) }),
    );
  });

  it("throws unless includeRawText is true", async () => {
    const { registry } = mockRegistryWith("[]");

    await expect(
      detectSemanticDeviations(TARGET, PROFILE, {
        // @ts-expect-error testing the opt-in gate
        includeRawText: false,
        registry,
      }),
    ).rejects.toThrow("includeRawText: true");
  });

  it("returns an empty array for empty target text without calling the provider", async () => {
    const mock = withSemanticHelpers(new MockAdapter({ defaultResponse: "[]" }));
    const complete = vi.spyOn(mock, "complete");

    const findings = await detectSemanticDeviations(
      "   ",
      PROFILE,
      { includeRawText: true, registry: mock },
      NODES,
    );

    expect(findings).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });

  it("treats caller abort as non-retryable", async () => {
    const controller = new AbortController();
    controller.abort();
    const registry = createLlmRegistry({
      provider: "mock",
      mock: { defaultResponse: "[]" },
    });

    await expect(
      detectSemanticDeviations(TARGET, PROFILE, {
        includeRawText: true,
        registry,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("retries retryable errors via withRetry", async () => {
    let calls = 0;
    const flaky = withSemanticHelpers(new MockAdapter({ defaultResponse: "[]" }));
    vi.spyOn(flaky, "complete").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        throw new LlmError("transient", "mock", true);
      }
      return {
        text: JSON.stringify([
          { deviation: "D", severity: "low", suggestion: "S", anchor: "target" },
        ]),
        model: "mock",
      };
    });

    const findings = await detect(flaky);

    expect(calls).toBe(2);
    expect(findings).toHaveLength(1);
  });

  it("produces a change from an anchored finding, with a precondition", async () => {
    // The capability this whole item exists to enable: a semantic finding that
    // the planner can actually turn into a reviewed change.
    const { planChanges } = await import("../../../src/changes/planner");
    const { registry } = mockRegistryWith(
      JSON.stringify([
        { deviation: "D", severity: "high", suggestion: "Use a fixed wording here.", anchor: "target" },
      ]),
    );
    const semantic = await detect(registry);
    const plan = planChanges({
      findings: semantic,
      docHash: "hash",
      baseDocId: "doc",
    });

    expect(plan.findings?.[0]?.actionable).toBe(true);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]?.precondition).toEqual({ kind: "text", expectedText: "target" });
    // AI-sourced, so it still cannot be applied without a human.
    expect(plan.changes[0]?.approvalRequired).toBe(true);
  });

  it("produces no change from an unanchored finding", async () => {
    const { planChanges } = await import("../../../src/changes/planner");
    const { registry } = mockRegistryWith(
      JSON.stringify([{ deviation: "D", severity: "high", suggestion: "S", anchor: "absent" }]),
    );
    const semantic = await detect(registry);
    const plan = planChanges({ findings: semantic, docHash: "hash", baseDocId: "doc" });

    expect(plan.findings?.[0]?.actionable).toBe(false);
    expect(plan.changes).toEqual([]);
  });

  it("feeds unifyFindings semantic input", async () => {
    const { unifyFindings } = await import("../../../src/analysis/unifiedFindings");
    const { registry } = mockRegistryWith(
      JSON.stringify([{ deviation: "D", severity: "high", suggestion: "S", anchor: "target" }]),
    );

    const semantic = await detect(registry);
    const merged = unifyFindings({ semantic });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.kind).toBe("semantic");
  });
});
