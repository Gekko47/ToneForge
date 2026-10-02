/**
 * Coverage truthfulness (spec §9, §20; gate 12).
 *
 * `buildDeterministicCoverage` is the only thing standing between "the host
 * would not serve this" and "ToneForge says the document is compliant", so the
 * cases below are written as pairs: the same scan, once with a scope mandatory
 * and once not, and the verdict has to differ only in the second. That is what
 * makes the file a test of the *distinction* rather than of a number.
 *
 * The failure this guards against is the one the plan records: `complete` used
 * to mean "every requested scope was examined", so a document whose tables the
 * host could not read reported "Incomplete" with no blocker to explain it — and a
 * user who sees "Incomplete" on a document they know has no tables learns to
 * ignore the word. The converse is worse: a genuine partial scan that reported
 * itself complete.
 */

import { describe, expect, it } from "vitest";

import { buildDeterministicCoverage } from "../../../../src/analysis/deterministic/coverage";
import { createAnalysisContext } from "../../../../src/analysis/analysisContext";
import { createGovernanceProfile } from "../../../../src/core/domain/GovernanceProfile";
import { DocumentNodeSchema } from "../../../../src/core/domain/DocumentSnapshot";
import { StyleProfileSchema } from "../../../../src/core/domain/StyleProfile";
import type { AnalysisCapabilities } from "../../../../src/analysis/analysisContext";
import type { ScopeKind } from "../../../../src/analysis/deterministic/contracts";
import type { GovernanceProfile } from "../../../../src/core/domain/GovernanceProfile";
import { SAMPLE_PROFILE } from "../../../fixtures/sampleDocs";

const PROFILE = StyleProfileSchema.parse(SAMPLE_PROFILE);

const NO_STRUCTURAL_SUPPORT: AnalysisCapabilities = {
  supportsInsertText: true,
  supportsReplaceText: true,
  supportsInsertParagraph: true,
  supportsInsertBreak: true,
  supportsStyles: true,
  supportsParagraphFormat: true,
  supportsCharacterFormat: true,
  supportsResetCharacterFormatting: true,
  supportsListLevel: true,
  supportsRevisions: true,
  supportsSelection: true,
  supportsRangedReplacement: true,
  supportsParagraphResolution: true,
  supportsHighlight: true,
  supportsContextMenuApi: true,
  supportsTables: false,
  supportsHeadersFooters: false,
  supportsSections: false,
  hostName: "Word",
  hostVersion: "16.0",
};

interface ContextOptions {
  text?: string;
  scope?: Partial<GovernanceProfile["scope"]>;
  capabilities?: Partial<AnalysisCapabilities>;
  /** Acquisition tokens naming what the host could not read. */
  unsupported?: string[];
  /** Acquisition tokens naming what this pass did not attempt. */
  notAttempted?: string[];
  /** Extra nodes, so `sectionsExamined` and friends are not always zero. */
  extraNodes?: Array<{ type: string; nodeId: string }>;
}

function contextFor(options: ContextOptions = {}) {
  const text = options.text ?? "A body paragraph with a table in it.";
  const base = createGovernanceProfile(PROFILE, "coverage-test");
  const policy: GovernanceProfile = {
    ...base,
    scope: { ...base.scope, ...options.scope },
  };
  const nodes = [
    DocumentNodeSchema.parse({
      nodeId: "body",
      type: "body",
      sourcePath: "body",
      editable: true,
      includedInGovernance: true,
      includedInAIReview: true,
    }),
    DocumentNodeSchema.parse({
      nodeId: "p-1",
      type: "paragraph",
      text,
      sourcePath: "body/paragraph/0",
      editable: true,
      includedInGovernance: true,
      includedInAIReview: true,
    }),
    ...(options.extraNodes ?? []).map((node) =>
      DocumentNodeSchema.parse({
        nodeId: node.nodeId,
        type: node.type,
        sourcePath: `body/${node.nodeId}`,
        editable: false,
        includedInGovernance: true,
        includedInAIReview: false,
        protectionReason: "read-only-scope",
      }),
    ),
  ];
  return createAnalysisContext({
    snapshot: {
      documentId: "doc-1",
      versionToken: "v1",
      contentHash: "hash-1",
      structuralHash: "struct-1",
      capturedAt: "2026-01-01T00:00:00.000Z",
      fullText: text,
      analysisText: text,
      analysisStart: 0,
      analysisEnd: text.length,
      analysisTruncated: false,
      nodes,
    },
    formatting: {
      id: "coverage-test",
      text,
      fullText: text,
      paragraphs: [],
      capturedAt: "2026-01-01T00:00:00.000Z",
    },
    profile: PROFILE,
    policy,
    capabilities: { ...NO_STRUCTURAL_SUPPORT, ...options.capabilities },
    acquisition: {
      runId: "coverage-test",
      acquisitionReadCount: 1,
      syncCount: 2,
      analyzedCharacterCount: text.length,
      completeDocumentCharacterCount: text.length,
      fullBodyReadCount: 1,
      paragraphCollectionRead: true,
      structuralCoverage: "complete",
      unsupported: options.unsupported ?? [],
      notAttempted: options.notAttempted ?? [],
      incremental: false,
      incrementalReason: "none",
    },
  });
}

describe("coverage truthfulness (spec §9, §20, gate 12)", () => {
  it("treats a scope the host cannot read as unsupported, not as unexamined", () => {
    const coverage = buildDeterministicCoverage({
      context: contextFor({ unsupported: ["tables"] }),
    });

    expect(coverage.unsupportedScopes).toContain("tables");
    // Not "excluded by policy": nothing in the policy kept it out. The remedy
    // is a different Word, and the reader has to be told which one.
    expect(coverage.excludedScopes).toContain("tables");
    expect(
      coverage.blockers.some(
        (blocker) => blocker.scope === "tables" && blocker.cause === "unsupportedByHost",
      ),
    ).toBe(false);
  });

  it("refuses compliance for a mandatory scope the host cannot read", () => {
    const coverage = buildDeterministicCoverage({
      context: contextFor({
        unsupported: ["tables"],
        scope: { mandatoryScopes: ["body", "headings", "tables"] },
      }),
    });

    expect(coverage.complete).toBe(false);
    const blocker = coverage.blockers.find((entry) => entry.scope === "tables");
    expect(blocker?.cause).toBe("unsupportedByHost");
    expect(blocker?.reason).toMatch(/required/);
  });

  it("reports compliance for the same scan when the scope is not mandatory", () => {
    /*
     * The pair that matters. Identical host, identical document, identical
     * findings — the only difference is whether the author insisted on the
     * scope. Before `mandatoryScopes`, both halves said "Incomplete" and the
     * user had no way to tell which gaps mattered.
     */
    const coverage = buildDeterministicCoverage({
      context: contextFor({ unsupported: ["tables"] }),
    });

    expect(coverage.complete).toBe(true);
    expect(coverage.blockers).toEqual([]);
    // The gap is still on the record. Silence is what would have been the lie.
    expect(coverage.excludedScopes).toContain("tables");
  });

  it("always treats the body as mandatory, whatever the policy says", () => {
    // A run that examined part of the body cannot speak for the document, and a
    // policy that chose otherwise would be a setting that disables the one
    // guarantee the report exists to make.
    const coverage = buildDeterministicCoverage({
      context: contextFor({ scope: { mandatoryScopes: ["headings"] } }),
      examinedNodeIds: ["p-1"],
      incremental: true,
      incrementalReason: "Word reported 1 changed paragraph.",
    });

    expect(coverage.complete).toBe(false);
    expect(coverage.blockers.some((blocker) => blocker.scope === "body")).toBe(true);
  });

  it("never reports a narrowed run as complete, however few scopes it missed", () => {
    const coverage = buildDeterministicCoverage({
      context: contextFor({ scope: { mandatoryScopes: ["body"] } }),
      examinedNodeIds: ["p-1"],
      incremental: true,
      incrementalReason: "Word reported 1 changed paragraph.",
    });

    expect(coverage.complete).toBe(false);
    expect(coverage.blockers.length).toBeGreaterThan(0);
    expect(coverage.blockers[0]?.reason).toMatch(/changed paragraph|not looked at/);
  });

  it("never reports a short node set as complete when the caller did not say it was partial", () => {
    // The observer narrows `context.nodes` itself, so `examinedNodeIds` equals
    // `context.nodes` there and the arithmetic is zero by construction. This
    // case is the other route: a caller that acquired everything and examined
    // part of it, with no `incremental` flag to catch it.
    const context = contextFor();
    const coverage = buildDeterministicCoverage({
      context,
      examinedNodeIds: ["p-1"],
    });

    expect(coverage.complete).toBe(false);
    expect(coverage.blockers.some((blocker) => blocker.scope === "body")).toBe(true);
  });

  it("counts the structural objects it actually examined", () => {
    // §20 asks for what was examined, not what the policy allowed. A scan that
    // read two sections and three header/footer slots and reported zeroes is
    // indistinguishable from a document that has none.
    const coverage = buildDeterministicCoverage({
      context: contextFor({
        capabilities: { supportsSections: true, supportsHeadersFooters: true },
        scope: { includeHeadersFooters: true, mandatoryScopes: ["body", "headings"] },
        extraNodes: [
          { type: "section", nodeId: "s-1" },
          { type: "section", nodeId: "s-2" },
          { type: "header", nodeId: "h-1" },
          { type: "footer", nodeId: "f-1" },
          { type: "footer", nodeId: "f-2" },
        ],
      }),
    });

    expect(coverage.sectionsExamined).toBe(2);
    // Two node types, one scope: Word distinguishes a header from a footer and
    // the scope policy does not.
    expect(coverage.headersFootersExamined).toBe(3);
  });

  it("reports a scope excluded by the policy as not requested, and never blocks on it", () => {
    // A scope the policy switched off is not a gap: nothing asked for it. The
    // host still may or may not be able to read it, and that is reported
    // separately — but an excluded scope is not a *blocker* and does not make
    // the run incomplete. The remedy for "not read" is a different Word; the
    // remedy for "excluded" is to re-include it, and only one of the two is a
    // reason to refuse Apply.
    const coverage = buildDeterministicCoverage({
      context: contextFor({ scope: { includeTables: false } }),
    });

    expect(coverage.requestedScopes).not.toContain("tables");
    expect(coverage.excludedScopes).not.toContain("tables");
    expect(coverage.complete).toBe(true);
    // No blocker for a scope nobody asked for.
    expect(coverage.blockers.some((blocker) => blocker.scope === "tables")).toBe(false);
  });

  it("asks for the section scope when the policy says to", () => {
    // Without `includeSections` in the policy-to-scope map, `sections` was never
    // *requested*, so it could never be a blocker and never an exclusion either
    // — the "asked for nothing, so nothing is missing" case that reads as
    // complete. A section flag in the policy that nothing reads is a setting
    // that changes nothing.
    const requested = buildDeterministicCoverage({
      context: contextFor({ capabilities: { supportsSections: true } }),
    }).requestedScopes;
    expect(requested).toContain("sections");
  });

  it("fingerprints what was examined, so a re-scan of the same scope keeps approvals", () => {
    // Spec §16: the fingerprint is part of the review-session identity. A
    // fingerprint derived from the run rather than the scope would invalidate
    // every approval on every rescan.
    const first = buildDeterministicCoverage({ context: contextFor() });
    const second = buildDeterministicCoverage({ context: contextFor() });
    expect(first.coverageFingerprint).toBe(second.coverageFingerprint);
  });

  it("changes the fingerprint when the examined scope changes", () => {
    const base = buildDeterministicCoverage({ context: contextFor() });
    const widened = buildDeterministicCoverage({
      context: contextFor({
        extraNodes: [{ type: "table", nodeId: "t-1" }],
      }),
    });
    expect(base.coverageFingerprint).not.toBe(widened.coverageFingerprint);
  });

  it("excludes every mandatory scope it could not examine, with a stated cause", () => {
    const coverage = buildDeterministicCoverage({
      context: contextFor({
        unsupported: ["tables", "sections"],
        scope: { mandatoryScopes: ["body", "headings", "tables", "sections"] },
      }),
    });

    const scopes = coverage.blockers.map((blocker) => blocker.scope);
    expect(scopes).toContain("tables");
    expect(scopes).toContain("sections");
    coverage.blockers.forEach((blocker) => {
      expect(blocker.reason.length).toBeGreaterThan(10);
      expect(
        (["unsupportedByHost", "excludedByPolicy", "protected"] as const).includes(blocker.cause),
      ).toBe(true);
    });
  });

  it("never lists a scope as both examined and excluded", () => {
    // The two lists are derived from the same comparison, and a scope appearing
    // in both is the internal contradiction a reader cannot resolve.
    const coverage = buildDeterministicCoverage({
      context: contextFor({
        unsupported: ["tables"],
        extraNodes: [{ type: "table", nodeId: "t" }],
      }),
    });
    const overlap = coverage.examinedScopes.filter((scope: ScopeKind) =>
      coverage.excludedScopes.includes(scope),
    );
    expect(overlap).toEqual([]);
  });
});
