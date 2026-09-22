import { describe, expect, it, vi, afterEach } from "vitest";

import {
  checkConsistency,
  ConsistencyReportSchema,
} from "../../../src/analysis/consistencyChecker";
import { withSemanticHelpers } from "../../../src/ai/providers/LlmProvider";
import { MockAdapter } from "../../../src/ai/providers/mockAdapter";
import { StyleProfileSchema } from "../../../src/core/domain/StyleProfile";
import { SAMPLE_PROFILE } from "../../fixtures/sampleDocs";
import type { FormattingSnapshot } from "../../../src/formatting/formattingSnapshot";

const PROFILE = StyleProfileSchema.parse(SAMPLE_PROFILE);

function paragraph(
  index: number,
  text: string,
  styleName = "Normal",
): FormattingSnapshot["paragraphs"][number] {
  return {
    index,
    text,
    styleName,
    alignment: null,
    lineSpacing: null,
    spaceAfter: null,
    spaceBefore: null,
    listLevel: null,
    fontName: null,
    fontSize: null,
    fontColor: null,
    bold: null,
    italic: null,
    underline: null,
  };
}

function snapshot(
  paragraphs: FormattingSnapshot["paragraphs"] = [paragraph(0, "Normal paragraph here.")],
): FormattingSnapshot {
  return {
    id: "snapshot-1",
    text: paragraphs.map((p) => p.text).join("\n\n"),
    paragraphs,
    capturedAt: "2026-01-01T00:00:00.000Z",
    hash: "abc123",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkConsistency", () => {
  it("returns an empty report for empty text without provider calls", async () => {
    const registry = withSemanticHelpers(new MockAdapter({ defaultResponse: "[]" }));
    const complete = vi.spyOn(registry, "complete");

    const report = await checkConsistency({
      text: "   ",
      profile: PROFILE,
      includeRawText: true,
      registry,
    });

    expect(report.findings).toEqual([]);
    expect(report.summary.total).toBe(0);
    expect(report.profileId).toBe(PROFILE.id);
    expect(report.docHash).toMatch(/^[0-9a-f]{8}$/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("runs deterministic engines and reports counts", async () => {
    const report = await checkConsistency({
      text: 'This is a test. It has an em dash--and quotes "curly".',
      profile: PROFILE,
      includeRawText: false,
    });

    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.summary.total).toBe(report.findings.length);
    expect(report.summary.byKind.deterministic).toBe(report.findings.length);
    expect(report.summary.byKind.semantic).toBe(0);
    expect(report.summary.byKind.formatting).toBe(0);
  });

  it("includes formatting findings when a snapshot is supplied", async () => {
    const report = await checkConsistency({
      text: "Normal paragraph here.",
      profile: PROFILE,
      snapshot: snapshot(),
      includeRawText: false,
    });

    expect(report.summary.byKind.formatting).toBe(report.findings.length);
  });

  it("skips semantic when includeRawText is false", async () => {
    const registry = withSemanticHelpers(new MockAdapter({ defaultResponse: "[]" }));
    const complete = vi.spyOn(registry, "complete");

    const report = await checkConsistency({
      text: "Some text.",
      profile: PROFILE,
      includeRawText: false,
      registry,
    });

    expect(complete).not.toHaveBeenCalled();
    expect(report.summary.byKind.semantic).toBe(0);
  });

  it("runs semantic when includeRawText is true via MockAdapter", async () => {
    const registry = withSemanticHelpers(
      new MockAdapter({
        defaultResponse: JSON.stringify([
          { deviation: "Too casual", severity: "medium", suggestion: "Use formal tone" },
        ]),
      }),
    );

    const report = await checkConsistency({
      text: "Some target text here.",
      profile: PROFILE,
      includeRawText: true,
      registry,
    });

    expect(report.summary.byKind.semantic).toBe(1);
    expect(report.summary.byKind.deterministic).toBe(0);
    expect(report.findings[0]?.kind).toBe("semantic");
    expect(report.findings[0]?.category).toBe("semantic-deviation");
  });

  it("continues without semantic findings when the provider throws", async () => {
    const registry = withSemanticHelpers(new MockAdapter({ defaultResponse: "[]" }));
    vi.spyOn(registry, "complete").mockRejectedValue(new Error("network down"));

    const report = await checkConsistency({
      text: 'This is a test. It has an em dash--and quotes "curly".',
      profile: PROFILE,
      includeRawText: true,
      registry,
    });

    expect(report.summary.byKind.semantic).toBe(0);
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it("propagates caller abort instead of returning a partial report", async () => {
    const controller = new AbortController();
    controller.abort();
    const registry = withSemanticHelpers(new MockAdapter({ defaultResponse: "[]" }));

    await expect(
      checkConsistency({
        text: "Some text.",
        profile: PROFILE,
        includeRawText: true,
        signal: controller.signal,
        registry,
      }),
    ).rejects.toThrow();
  });

  it("propagates profileId and docHash", async () => {
    const report = await checkConsistency({
      text: "Some text.",
      profile: PROFILE,
      docHash: "deadbeef",
      includeRawText: false,
    });

    expect(report.profileId).toBe(PROFILE.id);
    expect(report.docHash).toBe("deadbeef");
  });

  it("deduplicates and sorts findings deterministically", async () => {
    const report = await checkConsistency({
      text: 'This is a test. It has an em dash--and quotes "curly".',
      profile: PROFILE,
      includeRawText: false,
    });

    const sorted = [...report.findings].sort((a, b) => a.range.start - b.range.start);
    expect(report.findings).toEqual(sorted);
  });

  it("uses deterministic summary counts", async () => {
    const report = await checkConsistency({
      text: 'This is a test. It has an em dash--and quotes "curly".',
      profile: PROFILE,
      includeRawText: false,
    });

    expect(
      report.summary.bySeverity.info +
        report.summary.bySeverity.warning +
        report.summary.bySeverity.error,
    ).toBe(report.summary.total);
  });

  it("merges all three sources with per-kind summary counts", async () => {
    const registry = withSemanticHelpers(
      new MockAdapter({
        defaultResponse: JSON.stringify([
          { deviation: "Too casual", severity: "medium", suggestion: "Use formal tone" },
        ]),
      }),
    );

    const report = await checkConsistency({
      text: 'This is a test. It has an em dash--and quotes "curly".',
      profile: PROFILE,
      snapshot: snapshot([
        paragraph(0, "Chapter one", "Heading 1"),
        paragraph(1, "Skipped level", "Heading 3"),
        paragraph(2, "", "Heading 2"),
      ]),
      includeRawText: true,
      registry,
    });

    expect(report.summary.byKind.deterministic).toBeGreaterThan(0);
    expect(report.summary.byKind.formatting).toBeGreaterThan(0);
    expect(report.summary.byKind.semantic).toBe(1);
    expect(report.summary.total).toBe(
      report.summary.byKind.deterministic +
        report.summary.byKind.formatting +
        report.summary.byKind.semantic,
    );
  });

  it("skips semantic findings when the provider returns invalid JSON", async () => {
    const registry = withSemanticHelpers(
      new MockAdapter({ defaultResponse: "not json at all {{{" }),
    );

    const report = await checkConsistency({
      text: 'This is a test. It has an em dash--and quotes "curly".',
      profile: PROFILE,
      includeRawText: true,
      registry,
    });

    expect(report.summary.byKind.semantic).toBe(0);
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it("computes a deterministic docHash when none is supplied", async () => {
    const first = await checkConsistency({
      text: "Some text.",
      profile: PROFILE,
      includeRawText: false,
    });
    const second = await checkConsistency({
      text: "Some text.",
      profile: PROFILE,
      includeRawText: false,
    });

    expect(first.docHash).toBe(second.docHash);
    expect(first.docHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("returns a report that validates against ConsistencyReportSchema", async () => {
    const registry = withSemanticHelpers(
      new MockAdapter({
        defaultResponse: JSON.stringify([
          { deviation: "Too casual", severity: "medium", suggestion: "Use formal tone" },
        ]),
      }),
    );

    const report = await checkConsistency({
      text: 'This is a test. It has an em dash--and quotes "curly".',
      profile: PROFILE,
      snapshot: snapshot(),
      includeRawText: true,
      registry,
    });

    expect(() => ConsistencyReportSchema.parse(report)).not.toThrow();
  });

  it("rejects a malformed profile with a typed error", async () => {
    await expect(
      checkConsistency({
        text: "Some text.",
        profile: { id: "not-a-uuid" } as never,
        includeRawText: false,
      }),
    ).rejects.toThrow();
  });
});
