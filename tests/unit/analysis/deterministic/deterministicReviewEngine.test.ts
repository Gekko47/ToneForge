import { describe, expect, it } from "vitest";

import {
  groupFindings,
  runDeterministicReview,
  summarize,
} from "../../../../src/analysis/deterministic/deterministicReviewEngine";
import {
  DeterministicFindingSchema,
  DeterministicReviewReportSchema,
} from "../../../../src/analysis/deterministic/contracts";
import type { DeterministicFinding } from "../../../../src/analysis/deterministic/contracts";
import {
  createGovernanceProfile,
  ScopePolicySchema,
} from "../../../../src/core/domain/GovernanceProfile";
import { resolveResolvedPolicy } from "../../../../src/core/domain/ResolvedPolicy";
import { createEmptyProfile, StyleProfileSchema } from "../../../../src/core/domain/StyleProfile";
import { SAMPLE_PROFILE } from "../../../fixtures/sampleDocs";
import {
  DETERMINISTIC_REVIEW_FIXTURES,
  REVIEW_PROFILE,
} from "../../../fixtures/deterministicReview";
import { createAnalysisContext } from "../../../../src/analysis/analysisContext";
import { DocumentNodeSchema } from "../../../../src/core/domain/DocumentSnapshot";
import type { AnalysisCapabilities } from "../../../../src/analysis/analysisContext";
import type { FormattingSnapshot } from "../../../../src/formatting/formattingSnapshot";

const PROFILE = StyleProfileSchema.parse(SAMPLE_PROFILE);

/** Every capability true, so a scope test is not gated on an absent probe. */
const FULL_CAPABILITIES: AnalysisCapabilities = {
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
  supportsParagraphResolution: true,
  supportsHighlight: true,
  supportsContextMenuApi: true,
  supportsTables: false,
  supportsHeadersFooters: false,
  supportsSections: false,
  hostName: "Word",
  hostVersion: "16.0",
};

function emptyFormatting(text: string): FormattingSnapshot {
  return {
    id: "engine-test",
    text,
    fullText: text,
    paragraphs: [],
    capturedAt: "2026-01-01T00:00:00.000Z",
  };
}

function contextFor(text: string, profile = PROFILE, formatting = emptyFormatting(text)) {
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
  ];
  const policy = createGovernanceProfile(profile);
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
    formatting,
    profile,
    policy,
    capabilities: FULL_CAPABILITIES,
    acquisition: {
      runId: "engine-test",
      acquisitionReadCount: 1,
      syncCount: 2,
      analyzedCharacterCount: text.length,
      completeDocumentCharacterCount: text.length,
      fullBodyReadCount: 1,
      paragraphCollectionRead: true,
      structuralCoverage: "complete",
      unsupported: [],
      incremental: false,
      incrementalReason: "none",
    },
  });
}

describe("runDeterministicReview", () => {
  it("returns an empty, complete report for whitespace-only text", async () => {
    const report = await runDeterministicReview({ context: contextFor("   ") });

    expect(report.findings).toEqual([]);
    expect(report.summary.total).toBe(0);
    expect(report.reviewType).toBe("deterministic");
    expect(report.profileId).toBe(PROFILE.id);
  });

  it("runs the deterministic rules and reports counts", async () => {
    const report = await runDeterministicReview({
      context: contextFor('This is a test -- and "quotes".'),
    });

    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.summary.total).toBe(report.findings.length);
    expect(report.summary.byCategoryGroup.language).toBeGreaterThan(0);
  });

  it("produces a report that validates against its own schema", async () => {
    const report = await runDeterministicReview({ context: contextFor("A test -- here.") });
    expect(() => DeterministicReviewReportSchema.parse(report)).not.toThrow();
  });

  it("reports the document identity it examined", async () => {
    const report = await runDeterministicReview({ context: contextFor("Some text.") });

    expect(report.documentIdentity.documentId).toBe("doc-1");
    expect(report.documentIdentity.contentHash).toBe("hash-1");
    expect(report.profileRevision).toBe(PROFILE.revision);
  });

  it("refuses a semantic profile", async () => {
    const semantic = StyleProfileSchema.parse({
      ...createEmptyProfile("Semantic"),
      kind: "semantic",
    });
    await expect(runDeterministicReview({ context: contextFor("text", semantic) })).rejects.toThrow(
      /deterministic profile/,
    );
  });

  it("refuses a resolved policy belonging to another profile", async () => {
    const other = StyleProfileSchema.parse({
      ...PROFILE,
      id: "33333333-3333-4333-8333-333333333333",
    });
    await expect(
      runDeterministicReview({
        context: contextFor("Some text."),
        resolvedPolicy: resolveResolvedPolicy(other, createGovernanceProfile(other)),
      }),
    ).rejects.toThrow(/different StyleProfile/);
  });

  it("produces no finding a semantic or consistency run could have produced", async () => {
    /*
     * Spec §27 gate 2, as a runtime assertion rather than a type-level one.
     * The narrowed `kind` already forbids it at compile time; this pins that the
     * engine's own construction does not reintroduce one, and would catch a
     * future `unifyFindings` that merged a semantic array back in.
     */
    const report = await runDeterministicReview({ context: contextFor("A test -- here.") });
    report.findings.forEach((finding) => {
      expect(["deterministic", "formatting"]).toContain(finding.kind);
    });
  });

  /*
   * The scope distinction, through the engine.
   *
   * Two halves of the same scan. The only difference is whether the policy named
   * tables as mandatory, and the verdict has to differ accordingly: an
   * unrequested-by-insistence gap is a limitation the report states, while a
   * mandatory one refuses Apply.
   *
   * This test used to assert `complete === false` for the *non*-mandatory case.
   * That was the behaviour the plan calls out as a defect: a document whose
   * tables the host cannot read reported "Incomplete" with a blocker naming a
   * host limitation, so the only thing a user could do with the verdict was
   * learn to ignore it.
   */
  it("names a scope the host could not read without failing the run", async () => {
    const context = contextFor("Some text.");
    const degraded = {
      ...context,
      acquisition: { ...context.acquisition, unsupported: ["tables"] },
    };
    const report = await runDeterministicReview({ context: degraded });

    expect(report.coverage.complete).toBe(true);
    expect(report.coverage.unsupportedScopes).toContain("tables");
    // Still on the record, which is what makes `complete` a claim rather than a
    // way of saying nothing.
    expect(report.coverage.excludedScopes).toContain("tables");
    expect(report.coverage.blockers).toEqual([]);
  });

  it("refuses the run when a mandatory scope could not be read", async () => {
    const context = contextFor("Some text.");
    const base = createGovernanceProfile(PROFILE);
    const degraded = {
      ...context,
      policy: {
        ...base,
        scope: {
          ...base.scope,
          // Parsed rather than written as a literal: `mandatoryScopes` is a
          // closed `ScopeKind` union, and a `string[]` here would be a widening
          // the test typechecks and the engine then mis-handles.
          ...ScopePolicySchema.parse({ mandatoryScopes: ["body", "headings", "tables"] }),
        },
      },
      acquisition: { ...context.acquisition, unsupported: ["tables"] },
    };
    const report = await runDeterministicReview({ context: degraded });

    expect(report.coverage.complete).toBe(false);
    expect(report.coverage.blockers.some((blocker) => blocker.scope === "tables")).toBe(true);
  });

  it("narrows to the examined nodes and says the run was partial", async () => {
    const report = await runDeterministicReview({
      context: contextFor("Some text."),
      examinedNodeIds: ["p-1"],
      incremental: true,
      incrementalReason: "Word reported 1 changed paragraph.",
    });

    expect(report.coverage.complete).toBe(false);
    expect(report.coverage.blockers.length).toBeGreaterThan(0);
  });

  it("reports table and section metadata deviations for T19/T20", async () => {
    const formatting = {
      id: "engine-test",
      text: "A table and a header.",
      fullText: "A table and a header.",
      paragraphs: [],
      capturedAt: "2026-01-01T00:00:00.000Z",
      tables: [
        {
          index: 0,
          nodeId: "table-1",
          sourcePath: "body/table/0",
          styleName: "Table Grid",
          headerRow: false,
          headerRowCount: 1,
          cellStyleName: "Table Cell",
          rowCount: 2,
          columnCount: 2,
        },
      ],
      sections: [
        {
          index: 0,
          nodeId: "section-1",
          sourcePath: "body/section/0",
          orientation: "portrait",
          margins: { top: 36, bottom: 36, left: 72, right: 72 },
          width: 5000,
          height: 7000,
        },
      ],
      headersFooters: [
        {
          index: 0,
          nodeId: "header-1",
          sourcePath: "header/primary/0",
          kind: "header",
          styleName: "Heading 1",
          font: { name: "Calibri", size: 12, color: "#000000", bold: false, italic: false },
          required: true,
        },
      ],
    } as FormattingSnapshot;

    const profile = StyleProfileSchema.parse({
      ...REVIEW_PROFILE,
      formatting: {
        ...REVIEW_PROFILE.formatting,
        tables: { styleName: "Table Normal", supported: true, headerRow: true, headerRowCount: 2 },
        page: { orientation: "landscape", supported: true },
        headersFooters: { styleName: "Header", required: true, supported: true },
      },
    });

    const context = {
      ...contextFor("A table and a header.", profile, formatting),
      capabilities: {
        ...FULL_CAPABILITIES,
        supportsTables: true,
        supportsHeadersFooters: true,
        supportsSections: true,
      },
    };
    const report = await runDeterministicReview({ context });

    expect(report.findings.some((finding) => finding.category === "formatting.tableStyle")).toBe(
      true,
    );
    expect(report.findings.some((finding) => finding.category === "formatting.pageSetup")).toBe(
      true,
    );
    expect(report.findings.some((finding) => finding.category === "formatting.headerFooter")).toBe(
      true,
    );
  });

  /*
   * The end-to-end proof that the structural standards are reachable.
   *
   * The test above builds its profile by hand, so it proves the *analyzer* reads
   * a table standard. It says nothing about whether a user can ever produce one:
   * and for the whole period this pass covered, the answer was no. The four
   * structural standards were declared in the profile schema, read by the
   * analyzer, and wired to registered rules — so the §11 audit reported all four
   * as covered — while no control anywhere in the pane could set them. At
   * runtime they sat at their schema defaults, `supported: false` with no style
   * name, and the table, header/footer and page-setup checks could never produce
   * a finding no matter what a user did.
   *
   * The registry audit cannot see this, because all it can check is that a rule
   * reads a field. Nothing in the automated graph connected "the user can set
   * this" to "this produces a finding", so both halves could be individually
   * green while the product did nothing. So this test drives the engine with
   * exactly the shape `DeterministicStyleSections` writes — same keys, same
   * `supported: true`, same optional fields — and asserts the findings appear.
   */
  describe("the structural standards are reachable from the profile editor", () => {
    const TEXT = "A table, a header, and a list.";

    /** The shape the editor's compare switches produce, verified field by field in its own test. */
    const EDITOR_WRITTEN_FORMATTING = {
      tables: {
        styleName: "Table Normal",
        headerRow: true,
        headerRowCount: 2,
        supported: true,
      },
      headersFooters: { styleName: "Header", required: true, supported: true },
      page: {
        orientation: "landscape" as const,
        margins: { top: 72 },
        supported: true,
      },
      lists: { styleName: "List Number", level: 0, supported: true },
    };

    type StructuralKey = keyof typeof EDITOR_WRITTEN_FORMATTING;

    function snapshotWithStructures(): FormattingSnapshot {
      return {
        id: "reachability",
        text: TEXT,
        fullText: TEXT,
        capturedAt: "2026-01-01T00:00:00.000Z",
        paragraphs: [{ index: 0, text: "List Number", listLevel: 2 }],
        tables: [
          {
            index: 0,
            nodeId: "table-1",
            sourcePath: "body/table/0",
            styleName: "Table Grid",
            headerRow: false,
            headerRowCount: 1,
            rowCount: 2,
            columnCount: 2,
          },
        ],
        sections: [
          { index: 0, nodeId: "section-1", sourcePath: "body/section/0", orientation: "portrait" },
        ],
        headersFooters: [
          {
            index: 0,
            nodeId: "header-1",
            sourcePath: "header/primary/0",
            kind: "header",
            styleName: "Heading 1",
            required: true,
          },
        ],
      } as FormattingSnapshot;
    }

    async function reportFor(
      formatting: Record<string, unknown>,
      capabilities: Partial<AnalysisCapabilities> = {},
    ) {
      const profile = StyleProfileSchema.parse({
        ...REVIEW_PROFILE,
        formatting: { ...REVIEW_PROFILE.formatting, ...formatting },
      });
      const context = {
        ...contextFor(TEXT, profile, snapshotWithStructures()),
        capabilities: {
          ...FULL_CAPABILITIES,
          supportsTables: true,
          supportsHeadersFooters: true,
          supportsSections: true,
          ...capabilities,
        },
      };
      return runDeterministicReview({ context });
    }

    it.each([
      ["tables", "formatting.tableStyle"],
      ["headersFooters", "formatting.headerFooter"],
      ["page", "formatting.pageSetup"],
    ] satisfies readonly [StructuralKey, string][])(
      "produces a finding from the %s standard the editor writes",
      async (key, category) => {
        const report = await reportFor({ [key]: EDITOR_WRITTEN_FORMATTING[key] });
        expect(report.findings.some((finding) => finding.category === category)).toBe(true);
      },
    );

    it("produces a list finding from the list standard the editor writes", async () => {
      const report = await reportFor({ lists: EDITOR_WRITTEN_FORMATTING.lists });
      expect(report.findings.some((finding) => finding.category === "formatting.listLevel")).toBe(
        true,
      );
    });

    /*
     * `supported: false` is the analyzer's deliberate floor: a profile parsed
     * from a record written before these fields existed must not start firing
     * findings nobody chose. It is also why the editor carries an explicit
     * switch rather than setting it implicitly — and it is why a standard that
     * is merely *stored* produces nothing, which is exactly the behaviour the
     * switch has to make visible to the user.
     */
    it("produces nothing while the standard is stored but not switched on", async () => {
      const report = await reportFor({
        tables: { styleName: "Table Normal", headerRow: true, supported: false },
      });
      expect(report.findings.some((finding) => finding.category === "formatting.tableStyle")).toBe(
        false,
      );
    });

    it("produces nothing on a host that cannot read the scope, even when switched on", async () => {
      // DD-3: the capability gate is independent of the author's intent. A
      // switched-on standard on a host that never served the data is a coverage
      // limitation, never a clean document.
      const report = await reportFor(
        { tables: EDITOR_WRITTEN_FORMATTING.tables },
        { supportsTables: false },
      );
      expect(report.findings.some((finding) => finding.category === "formatting.tableStyle")).toBe(
        false,
      );
    });
  });
});

describe("summarize", () => {
  it("counts severities, actionability and the three review groups", () => {
    const summary = summarize([
      DeterministicFindingSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "deterministic",
        category: "typography.emDash",
        range: { start: 0, end: 2, unit: "character" },
        message: "An em dash.",
        severity: "warning",
        confidence: 1,
      }),
      DeterministicFindingSchema.parse({
        id: "22222222-2222-4222-8222-222222222222",
        kind: "formatting",
        category: "formatting.bodyStyle",
        range: { start: 0, end: 1, unit: "paragraph" },
        message: "A body style deviation.",
        severity: "error",
        confidence: 1,
      }),
    ]);

    expect(summary.total).toBe(2);
    expect(summary.bySeverity.warning).toBe(1);
    expect(summary.bySeverity.error).toBe(1);
    expect(summary.byCategoryGroup.language).toBe(1);
    expect(summary.byCategoryGroup.formatting).toBe(1);
  });
});

describe("groupFindings", () => {
  /*
   * Built through the schema rather than as a literal, for the same reason the
   * engine's own report is asserted: a literal here would silently omit every
   * field the schema supplies by default, and the grouping rules under test read
   * some of those fields. A literal that typechecks against the *input* type is
   * a finding that is not the finding the code sees.
   */
  const finding = (id: string, overrides: Record<string, unknown> = {}): DeterministicFinding =>
    DeterministicFindingSchema.parse({
      id,
      kind: "deterministic",
      category: "typography.emDash",
      range: { start: 0, end: 2, unit: "character" },
      message: "An em dash.",
      severity: "warning",
      confidence: 1,
      nodeIds: [],
      ruleId: "typography/dashes",
      ...overrides,
    });

  it("treats a single occurrence as always safe to batch", () => {
    const groups = groupFindings([finding("11111111-1111-4111-8111-111111111111")], new Set());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.safeBatchApproval).toBe(true);
  });

  it("refuses batch approval for a group whose rule never declared a batch key", () => {
    const groups = groupFindings(
      [
        finding("11111111-1111-4111-8111-111111111111"),
        finding("22222222-2222-4222-8222-222222222222"),
      ],
      new Set(),
    );
    expect(groups[0]?.safeBatchApproval).toBe(false);
    expect(groups[0]?.batchRefusalReason).toMatch(/semantically|declared/i);
  });

  it("permits batch approval when every occurrence shares a safe batch key", () => {
    const withKey = (id: string) =>
      finding(id, { deterministic: { profilePath: "typography.emDash", safeBatchKey: "em" } });
    const groups = groupFindings(
      [
        withKey("11111111-1111-4111-8111-111111111111"),
        withKey("22222222-2222-4222-8222-222222222222"),
      ],
      new Set(),
    );
    expect(groups[0]?.safeBatchApproval).toBe(true);
    expect(groups[0]?.occurrenceIds).toHaveLength(2);
  });

  it("refuses batch approval when one occurrence is protected", () => {
    const withKey = (id: string, nodeIds: string[] = []) =>
      finding(id, {
        nodeIds,
        deterministic: { profilePath: "typography.emDash", safeBatchKey: "em" },
      });
    const groups = groupFindings(
      [
        withKey("11111111-1111-4111-8111-111111111111"),
        withKey("22222222-2222-4222-8222-222222222222", ["protected-1"]),
      ],
      new Set(["protected-1"]),
    );
    expect(groups[0]?.safeBatchApproval).toBe(false);
    expect(groups[0]?.batchRefusalReason).toMatch(/protected/i);
  });

  it("refuses batch approval when occurrences want different corrections", () => {
    const withExpected = (id: string, expected: string) =>
      finding(id, {
        deterministic: { profilePath: "typography.emDash", safeBatchKey: "em", expected },
      });
    const groups = groupFindings(
      [
        withExpected("11111111-1111-4111-8111-111111111111", "tight"),
        withExpected("22222222-2222-4222-8222-222222222222", "spaced"),
      ],
      new Set(),
    );
    expect(groups[0]?.safeBatchApproval).toBe(false);
    expect(groups[0]?.batchRefusalReason).toMatch(/one correction/i);
  });
});

describe("the §26 fixture corpus", () => {
  it("declares one fixture per case the specification names", () => {
    expect(DETERMINISTIC_REVIEW_FIXTURES).toHaveLength(11);
    expect(DETERMINISTIC_REVIEW_FIXTURES.map((fixture) => fixture.name)).toContain(
      "house terminology program to programme",
    );
    expect(DETERMINISTIC_REVIEW_FIXTURES.map((fixture) => fixture.name)).toContain(
      "unsupported scope",
    );
  });

  it("gives every fixture an intent and at least one expectation", () => {
    DETERMINISTIC_REVIEW_FIXTURES.forEach((fixture) => {
      expect(fixture.intent.length).toBeGreaterThan(10);
      expect(
        fixture.expectedCategories.length + Object.keys(fixture.absentCategories ?? {}).length,
      ).toBeGreaterThan(0);
    });
  });

  it("pins the mixed direct-formatting case to a non-correctable finding", () => {
    /*
     * This case is the plan for spec §14.5, and it is deliberately red until that
     * stage lands. Today `formatting.directFormatting` plans a
     * `resetCharacterFormatting`, which would erase the author's bold along with
     * the accidental override — so the fixture expects the category and expects
     * no correction, and the test suite will report the gap rather than pass
     * against the unsafe behaviour.
     */
    const fixture = DETERMINISTIC_REVIEW_FIXTURES.find(
      (entry) => entry.name === "mixed direct formatting",
    );
    expect(fixture).toBeDefined();
    expect(fixture?.nonCorrectableCategories).toContain("formatting.directFormatting");
    expect(fixture?.correctableCategories ?? []).not.toContain("formatting.directFormatting");
  });

  it("uses a profile the corpus can actually run", () => {
    expect(REVIEW_PROFILE.houseStyle.preferredTerminology.program).toBe("programme");
  });
});
