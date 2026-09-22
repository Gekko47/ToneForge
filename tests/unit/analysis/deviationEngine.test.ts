import { describe, it, expect, vi, afterEach } from "vitest";

import { detectSemanticDeviations } from "../../../src/analysis/deviationEngine";
import { createLlmRegistry } from "../../../src/ai/providers/registry";
import { MockAdapter } from "../../../src/ai/providers/mockAdapter";
import { withSemanticHelpers } from "../../../src/ai/providers/LlmProvider";
import { LlmError } from "../../../src/ai/providers/LlmProvider";
import { FindingSchema } from "../../../src/core/domain/Finding";
import { SAMPLE_PROFILE } from "../../fixtures/sampleDocs";
import { logger } from "../../../src/shared/utils/logger";
import type { StyleProfile } from "../../../src/core/domain/StyleProfile";

const PROFILE = SAMPLE_PROFILE as unknown as StyleProfile;

function mockRegistryWith(responseText: string) {
  const mock = withSemanticHelpers(new MockAdapter({ defaultResponse: responseText }));
  return { registry: mock, mock };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detectSemanticDeviations", () => {
  it("maps a valid JSON array to semantic findings", async () => {
    const { registry } = mockRegistryWith(
      JSON.stringify([
        { deviation: "Too casual", severity: "medium", suggestion: "Use formal tone" },
        { deviation: "Passive voice", severity: "high", suggestion: "Use active voice" },
      ]),
    );

    const findings = await detectSemanticDeviations("Some target text here.", PROFILE, {
      includeRawText: true,
      registry,
    });

    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(() => FindingSchema.parse(finding)).not.toThrow();
      expect(finding.kind).toBe("semantic");
      expect(finding.category).toBe("semantic-deviation");
      expect(finding.confidence).toBeLessThan(1);
    }
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toBe("Use formal tone");
    expect(findings[0]?.evidence).toBe("Too casual");
    expect(findings[1]?.severity).toBe("error");
    expect(findings[0]?.range).toEqual({
      start: 0,
      end: "Some target text here.".length,
      unit: "character",
    });
  });

  it("maps severity low to info", async () => {
    const { registry } = mockRegistryWith(
      JSON.stringify([{ deviation: "Minor", severity: "low", suggestion: "Tweak" }]),
    );

    const findings = await detectSemanticDeviations("Text.", PROFILE, {
      includeRawText: true,
      registry,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
  });

  it("throws on invalid JSON", async () => {
    const { registry } = mockRegistryWith("not json at all {{{");

    await expect(
      detectSemanticDeviations("Text.", PROFILE, { includeRawText: true, registry }),
    ).rejects.toThrow("not valid JSON");
  });

  it("throws when the response is not a JSON array", async () => {
    const { registry } = mockRegistryWith(JSON.stringify({ deviation: "x" }));

    await expect(
      detectSemanticDeviations("Text.", PROFILE, { includeRawText: true, registry }),
    ).rejects.toThrow("must be a JSON array");
  });

  it("skips schema-invalid entries instead of failing", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { registry } = mockRegistryWith(
      JSON.stringify([
        { deviation: "Good one", severity: "medium", suggestion: "Fix it" },
        { deviation: "", severity: "medium", suggestion: "Missing deviation text" },
        { severity: "high", suggestion: "Missing deviation field" },
      ]),
    );

    const findings = await detectSemanticDeviations("Text.", PROFILE, {
      includeRawText: true,
      registry,
    });

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
      detectSemanticDeviations("Text.", PROFILE, {
        // @ts-expect-error testing the opt-in gate
        includeRawText: false,
        registry,
      }),
    ).rejects.toThrow("includeRawText: true");
  });

  it("returns an empty array for empty target text without calling the provider", async () => {
    const mock = withSemanticHelpers(new MockAdapter({ defaultResponse: "[]" }));
    const complete = vi.spyOn(mock, "complete");

    const findings = await detectSemanticDeviations("   ", PROFILE, {
      includeRawText: true,
      registry: mock,
    });

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
      detectSemanticDeviations("Text.", PROFILE, {
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
        text: JSON.stringify([{ deviation: "D", severity: "low", suggestion: "S" }]),
        model: "mock",
      };
    });

    const findings = await detectSemanticDeviations("Text.", PROFILE, {
      includeRawText: true,
      registry: flaky,
    });

    expect(calls).toBe(2);
    expect(findings).toHaveLength(1);
  });

  it("feeds unifyFindings semantic input", async () => {
    const { unifyFindings } = await import("../../../src/analysis/unifiedFindings");
    const { registry } = mockRegistryWith(
      JSON.stringify([{ deviation: "D", severity: "high", suggestion: "S" }]),
    );

    const semantic = await detectSemanticDeviations("Text.", PROFILE, {
      includeRawText: true,
      registry,
    });
    const merged = unifyFindings({ semantic });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.kind).toBe("semantic");
  });
});
