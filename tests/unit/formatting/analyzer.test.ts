/**
 * Profile-driven formatting checks (spec §10).
 *
 * The tests below are written against the profile rather than against the
 * document, because that is the claim the module makes: a paragraph deviates
 * when it differs from the standard the *user* configured. Several of them
 * assert the same document produces no finding under one profile and a finding
 * under another — which is the assertion the old heuristic module could not
 * satisfy, because it had no profile to change.
 */

import { describe, expect, it } from "vitest";
import {
  findFormattingIssues,
  type FormattingCapabilities,
} from "../../../src/formatting/analyzer";
import {
  DocumentFormattingProfileSchema,
  DocumentStructureProfileSchema,
} from "../../../src/core/domain/StyleProfile";
import type { FormattingSnapshot } from "../../../src/formatting/formattingSnapshot";

const CAPABILITIES: FormattingCapabilities = {
  supportsStyles: true,
  supportsParagraphFormat: true,
  supportsListLevel: true,
};

const NO_CAPABILITIES: FormattingCapabilities = {
  supportsStyles: false,
  supportsParagraphFormat: false,
  supportsListLevel: false,
};

function snapshot(paragraphs: FormattingSnapshot["paragraphs"]): FormattingSnapshot {
  return {
    id: "snapshot-1",
    text: paragraphs.map((p) => p.text).join("\n\n"),
    paragraphs,
    capturedAt: "2026-01-01T00:00:00.000Z",
    hash: "abc123",
  };
}

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

/**
 * A document standard. `bodyStyle` is required by the schema, so the default
 * here states it explicitly rather than relying on the object-level `.default()`,
 * which only applies when the whole profile is absent.
 */
function profile(overrides: Record<string, unknown> = {}) {
  return DocumentFormattingProfileSchema.parse({
    bodyStyle: { styleName: "Normal" },
    ...overrides,
  });
}

function structure(overrides: unknown = {}) {
  return DocumentStructureProfileSchema.parse(overrides);
}

function run(
  paragraphs: FormattingSnapshot["paragraphs"],
  options: {
    profile?: ReturnType<typeof profile>;
    structure?: ReturnType<typeof structure>;
    capabilities?: FormattingCapabilities;
    provenance?: "partial" | "unsupported";
  } = {},
) {
  return findFormattingIssues({
    snapshot: {
      ...snapshot(paragraphs),
      coverage: {
        paragraphCollection: "partial",
        directFormattingProvenance: options.provenance ?? "partial",
        unsupported: [],
      },
    },
    profile: options.profile ?? profile(),
    structure: options.structure ?? structure(),
    capabilities: options.capabilities ?? CAPABILITIES,
  });
}

const categories = (findings: ReturnType<typeof run>) => findings.map((f) => f.category);

describe("findFormattingIssues", () => {
  it("returns an empty array for empty input", () => {
    expect(run([])).toEqual([]);
  });

  it("returns no findings for a paragraph that matches the body standard", () => {
    expect(run([paragraph(0, "A clean paragraph.")])).toEqual([]);
  });

  describe("body paragraphs (spec §10.1)", () => {
    it("reports a body paragraph carrying a style the profile did not name", () => {
      const findings = run([paragraph(0, "Body text", "Body Text")], {
        profile: profile({ bodyStyle: { styleName: "Normal" } }),
      });
      const body = findings.filter((f) => f.category === "formatting.bodyStyle");
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        expected: "Normal",
        severity: "warning",
        deterministic: { profilePath: "formatting.bodyStyle.styleName", expected: "Normal" },
      });
    });

    it("says nothing when the profile names the style the paragraph already carries", () => {
      const findings = run([paragraph(0, "Body text", "Body Text")], {
        profile: profile({ bodyStyle: { styleName: "Body Text" } }),
      });
      expect(categories(findings)).not.toContain("formatting.bodyStyle");
    });

    it("does not report a heading as a body-style deviation", () => {
      const findings = run([paragraph(0, "A heading", "Heading 1")], {
        profile: profile({ bodyStyle: { styleName: "Normal" } }),
      });
      expect(categories(findings)).not.toContain("formatting.bodyStyle");
    });

    it("does not report a list paragraph as a body-style deviation", () => {
      const findings = run([
        { ...paragraph(0, "An item"), styleName: "List Paragraph", listLevel: 0 },
      ]);
      expect(categories(findings)).not.toContain("formatting.bodyStyle");
    });

    it("compares the configured paragraph properties it actually read", () => {
      const findings = run([{ ...paragraph(0, "Body"), spaceAfter: 0, alignment: "left" }], {
        profile: profile({
          bodyStyle: { styleName: "Normal", paragraph: { spaceAfter: 12, alignment: "justified" } },
        }),
      });
      const paths = findings
        .filter((f) => f.category === "formatting.bodyStyle")
        .map((f) => f.deterministic?.profilePath);
      expect(paths).toContain("formatting.bodyStyle.paragraph.spaceAfter");
      expect(paths).toContain("formatting.bodyStyle.paragraph.alignment");
    });

    /*
     * The load-bearing assertion of the whole change. `null` means the host did
     * not serve the property; treating it as `0` would report a compliant
     * paragraph as non-compliant, which is the false-compliance claim spec §9
     * exists to prevent.
     */
    it("does not compare a property the host never read", () => {
      const findings = run([{ ...paragraph(0, "Body"), spaceAfter: null, leftIndent: null }], {
        profile: profile({
          bodyStyle: { styleName: "Normal", paragraph: { spaceAfter: 0, leftIndent: 0 } },
        }),
      });
      expect(findings).toEqual([]);
    });

    it("reports a mis-styled title separately from a body deviation", () => {
      const findings = run([paragraph(0, "The report", "Title")], {
        profile: profile({
          bodyStyle: { styleName: "Normal" },
          titleStyle: { styleName: "Report Title" },
        }),
      });
      expect(categories(findings)).toEqual(["formatting.styleStandard"]);
      expect(findings[0]?.deterministic?.profilePath).toBe("formatting.titleStyle.styleName");
    });
  });

  describe("headings (spec §10.2)", () => {
    it("verifies the style identity of each configured heading level", () => {
      const findings = run([paragraph(0, "Section", "Heading 2")], {
        profile: profile({
          bodyStyle: { styleName: "Normal" },
          headings: { "2": { styleName: "H2" } },
        }),
      });
      const heading = findings.filter((f) => f.category === "formatting.headingStyle");
      expect(heading).toHaveLength(1);
      expect(heading[0]).toMatchObject({
        expected: "H2",
        deterministic: { profilePath: "formatting.headings.2.styleName" },
      });
    });

    it("reports a skipped level separately from a visual non-compliance", () => {
      const findings = run(
        [paragraph(0, "Intro", "Heading 1"), paragraph(1, "Detail", "Heading 3")],
        { profile: profile({ bodyStyle: { styleName: "Normal" } }) },
      );
      // Heading 3 has no configured standard, so only the hierarchy rule fires.
      expect(categories(findings)).toEqual(["formatting.headingHierarchy"]);
    });

    it("says nothing about a level the profile has not configured", () => {
      const findings = run([paragraph(0, "Section", "Heading 3")], {
        profile: profile({ bodyStyle: { styleName: "Normal" } }),
      });
      expect(categories(findings)).not.toContain("formatting.headingStyle");
    });

    it("honours a profile that permits skipped levels", () => {
      const findings = run(
        [paragraph(0, "Intro", "Heading 1"), paragraph(1, "Detail", "Heading 3")],
        { structure: structure({ allowSkippedHeadingLevels: true }) },
      );
      expect(categories(findings)).not.toContain("formatting.headingHierarchy");
    });

    it("reports a heading deeper than the profile's maximum", () => {
      const findings = run([paragraph(0, "Deep", "Heading 5")], {
        structure: structure({ maxHeadingLevel: 3 }),
      });
      const hierarchy = findings.filter((f) => f.category === "formatting.headingHierarchy");
      expect(hierarchy).toHaveLength(1);
      expect(hierarchy[0]?.deterministic?.profilePath).toBe("structure.maxHeadingLevel");
    });
  });

  describe("direct formatting (spec §10.3)", () => {
    const directParagraph = {
      ...paragraph(0, "Styled text"),
      fontName: "Arial",
      fontSize: 12,
      bold: true,
      provenance: {
        alignment: "style",
        lineSpacing: "style",
        spaceAfter: "style",
        spaceBefore: "style",
        listLevel: "style",
        fontName: "direct",
        fontSize: "direct",
        fontColor: "style",
        bold: "direct",
        italic: "style",
        underline: "style",
      },
    } as FormattingSnapshot["paragraphs"][number];

    it("does not report direct formatting while the profile allows it", () => {
      const findings = run([directParagraph], {
        profile: profile({ bodyStyle: { styleName: "Normal", styleControlledFormatting: false } }),
      });
      expect(categories(findings)).not.toContain("formatting.directFormatting");
    });

    it("reports a material override when the profile says the style owns it", () => {
      const findings = run([directParagraph], {
        profile: profile({ bodyStyle: { styleName: "Normal", styleControlledFormatting: true } }),
      });
      const direct = findings.filter((f) => f.category === "formatting.directFormatting");
      expect(direct).toHaveLength(1);
      expect(direct[0]?.message).toContain("fontName");
    });

    /*
     * The bold run is the author's emphasis. Clearing direct formatting with
     * `font.reset()` would remove it, so the rule must not count it as an
     * override — and must not offer a correction, because the only correction
     * available would remove it.
     */
    it("never treats bold, italic or underline as an override", () => {
      const findings = run([directParagraph], {
        profile: profile({ bodyStyle: { styleName: "Normal", styleControlledFormatting: true } }),
      });
      const direct = findings.find((f) => f.category === "formatting.directFormatting");
      expect(direct?.message).not.toContain("bold");
      expect(direct?.deterministic?.correctionAvailable).toBe(false);
      expect(direct?.deterministic?.correctionReason).toContain("emphasis");
    });

    it("reports nothing when the host could not establish provenance", () => {
      const findings = run([directParagraph], {
        profile: profile({ bodyStyle: { styleName: "Normal", styleControlledFormatting: true } }),
        provenance: "unsupported",
      });
      expect(categories(findings)).not.toContain("formatting.directFormatting");
    });
  });

  describe("lists", () => {
    it("reports a list paragraph carrying a style the profile did not name", () => {
      const findings = run(
        [{ ...paragraph(0, "An item"), styleName: "List Bullet", listLevel: 0 }],
        {
          profile: profile({
            bodyStyle: { styleName: "Normal" },
            lists: { styleName: "List Paragraph" },
          }),
        },
      );
      const listStyle = findings.filter((f) => f.category === "formatting.listStyle");
      expect(listStyle).toHaveLength(1);
      expect(listStyle[0]?.deterministic?.profilePath).toBe("formatting.lists.styleName");
    });

    it("compares the list level only when the profile says the check is supported", () => {
      const paragraphs = [{ ...paragraph(0, "An item"), styleName: "List Bullet", listLevel: 2 }];

      const unsupported = run(paragraphs, {
        profile: profile({
          bodyStyle: { styleName: "Normal" },
          lists: { level: 0, supported: false },
        }),
      });
      expect(categories(unsupported)).not.toContain("formatting.listLevel");

      const supported = run(paragraphs, {
        profile: profile({
          bodyStyle: { styleName: "Normal" },
          lists: { level: 0, supported: true },
        }),
      });
      const level = supported.filter((f) => f.category === "formatting.listLevel");
      expect(level).toHaveLength(1);
      expect(level[0]?.deterministic?.profilePath).toBe("formatting.lists.level");
    });

    it("says nothing about a list level the host could not read", () => {
      const findings = run(
        [{ ...paragraph(0, "An item"), styleName: "List Bullet", listLevel: 2 }],
        {
          profile: profile({
            bodyStyle: { styleName: "Normal" },
            lists: { level: 0, supported: true },
          }),
          capabilities: NO_CAPABILITIES,
        },
      );
      expect(categories(findings)).not.toContain("formatting.listLevel");
    });

    /*
     * Document integrity rather than profile compliance: a paragraph three
     * levels deep carrying `Normal` is anomalous whichever profile is active, so
     * the rule runs even for a profile that says nothing about lists.
     */
    it("flags a list level on a non-list style regardless of the profile", () => {
      const findings = run([{ ...paragraph(0, "Deep item"), listLevel: 3 }]);
      const level = findings.filter((f) => f.category === "formatting.listLevel");
      expect(level).toHaveLength(1);
      expect(level[0]?.deterministic?.profilePath).toBe("structure.listLevelIntegrity");
      expect(level[0]?.expected).toBeUndefined();
      expect(level[0]?.deterministic?.correctionAvailable).toBe(false);
      expect(level[0]?.deterministic?.correctionReason).toContain("cannot safely infer");
    });

    it("does not flag a list level on a list style", () => {
      const findings = run([
        { ...paragraph(0, "An item"), styleName: "List Bullet", listLevel: 1 },
      ]);
      expect(categories(findings)).not.toContain("formatting.listLevel");
    });

    /*
     * Word's numbered list styles.
     *
     * The recognised set held only the four base names, so `List Number 2` was
     * not a list style at all. A correctly formatted nested list item then
     * produced two findings from one cause: a body-style deviation, because the
     * body standard applied to it, and a list-level integrity finding, because
     * the level check saw a non-list style indented to level 2. The second of
     * those is the one that matters — it points at the author's own list
     * structure as though it were corrupt.
     */
    it.each([
      "List Bullet 2",
      "List Bullet 5",
      "List Number 2",
      "List Number 3",
      "List Continue 2",
      "List 2",
      "List 5",
      "List Paragraph",
    ])("treats %s as a list style, not a body paragraph", (styleName) => {
      const findings = run([{ ...paragraph(0, "Nested item"), styleName, listLevel: 1 }]);

      // Not a body-style deviation: the body standard must not apply to a list.
      expect(categories(findings)).not.toContain("formatting.bodyStyle");
      // And not a level-integrity finding: the style *is* a list style.
      expect(categories(findings)).not.toContain("formatting.listLevel");
    });

    it("still treats a non-list style carrying a level as anomalous", () => {
      // The counterpart, so the pattern is not simply matching anything: a
      // custom body style at level 3 remains a genuine integrity finding.
      const findings = run([
        { ...paragraph(0, "Deep item"), styleName: "Body Text", listLevel: 3 },
      ]);
      const level = findings.filter((f) => f.category === "formatting.listLevel");
      expect(level).toHaveLength(1);
      expect(level[0]?.deterministic?.profilePath).toBe("structure.listLevelIntegrity");
    });

    it("groups a list style deviation by the style the profile wants", () => {
      // Spec §13: a group is one correction, so every list paragraph wanting
      // "List Paragraph" is one decision. Grouping on the category alone would
      // merge them with paragraphs wanting a different list style.
      const findings = run(
        [
          { ...paragraph(0, "One"), styleName: "List Bullet" },
          { ...paragraph(1, "Two"), styleName: "List Number" },
        ],
        {
          profile: profile({
            bodyStyle: { styleName: "Normal" },
            lists: { styleName: "List Paragraph", supported: true },
          }),
        },
      );
      const styles = findings.filter((f) => f.category === "formatting.listStyle");
      expect(styles).toHaveLength(2);
      expect(new Set(styles.map((f) => f.deterministic?.occurrenceGroupKey)).size).toBe(1);
    });

    it("offers a safe batch for a list style deviation, which applyStyle makes safe", () => {
      // `applyStyle` of one named Word style to N list paragraphs is the same
      // edit N times, exactly as it is for a body paragraph.
      const findings = run([{ ...paragraph(0, "One"), styleName: "List Bullet" }], {
        profile: profile({
          bodyStyle: { styleName: "Normal" },
          lists: { styleName: "List Paragraph", supported: true },
        }),
      });
      const style = findings.find((f) => f.category === "formatting.listStyle");
      expect(style?.deterministic?.safeBatchKey).toBe("style:formatting.lists|List Paragraph");
    });

    it("groups a level deviation by the level the profile wants", () => {
      const findings = run(
        [
          { ...paragraph(0, "One"), styleName: "List Bullet", listLevel: 2 },
          { ...paragraph(1, "Two"), styleName: "List Bullet", listLevel: 3 },
        ],
        {
          profile: profile({
            bodyStyle: { styleName: "Normal" },
            lists: { level: 0, supported: true },
          }),
        },
      );
      const levels = findings.filter((f) => f.category === "formatting.listLevel");
      expect(levels).toHaveLength(2);
      expect(
        levels.every((f) => f.deterministic?.occurrenceGroupKey === "formatting.lists.level|0"),
      ).toBe(true);
    });

    it("never offers a safe batch for a level deviation, which rewrites list structure", () => {
      // `setListLevel` on a paragraph the host calls a list item is the
      // structurally ambiguous change spec §13 says never goes in bulk, so the
      // group is visible but batch approval is refused.
      const findings = run([{ ...paragraph(0, "One"), styleName: "List Bullet", listLevel: 2 }], {
        profile: profile({
          bodyStyle: { styleName: "Normal" },
          lists: { level: 0, supported: true },
        }),
      });
      const level = findings.find((f) => f.category === "formatting.listLevel");
      expect(level?.deterministic?.occurrenceGroupKey).toBeDefined();
      expect(level?.deterministic?.safeBatchKey).toBeUndefined();
    });

    it("never offers a safe batch for a level on a non-list style", () => {
      const findings = run([{ ...paragraph(0, "Deep item"), listLevel: 3 }]);
      const level = findings.find((f) => f.category === "formatting.listLevel");
      expect(level?.deterministic?.occurrenceGroupKey).toBe("structure.listLevelIntegrity|0");
      expect(level?.deterministic?.safeBatchKey).toBeUndefined();
    });
  });

  describe("document integrity", () => {
    it("flags empty style names as informational findings", () => {
      const findings = run([paragraph(0, "Body", "")]);
      expect(categories(findings)).toEqual(["formatting.emptyStyle"]);
      expect(findings[0]?.severity).toBe("info");
    });

    it("flags unknown styles once, as an informational finding", () => {
      const findings = run([
        paragraph(0, "Body", "Custom Style"),
        paragraph(1, "Again", "Custom Style"),
      ]);
      const unknown = findings.filter((f) => f.category === "formatting.unknownStyle");
      expect(unknown).toHaveLength(1);
      expect(unknown[0]).toMatchObject({ severity: "info", evidence: "Custom Style" });
    });

    it("does not offer to replace an unknown style, which would discard author structure", () => {
      const findings = run([paragraph(0, "Body", "Custom Style")]);
      const unknown = findings.find((f) => f.category === "formatting.unknownStyle");
      expect(unknown?.deterministic?.correctionAvailable).toBe(false);
    });

    it("stays silent on unknown styles when the profile says not to report them", () => {
      const findings = run([paragraph(0, "Body", "Custom Style")], {
        structure: structure({ reportUnknownStyles: false }),
      });
      expect(categories(findings)).not.toContain("formatting.unknownStyle");
    });

    it("stays silent on empty headings when the profile says not to report them", () => {
      const findings = run([paragraph(0, "", "Heading 2")], {
        structure: structure({ reportEmptyHeadings: false }),
      });
      expect(categories(findings)).not.toContain("formatting.emptyHeading");
    });

    it("flags empty heading or title paragraphs", () => {
      const findings = run([paragraph(0, "", "Title"), paragraph(1, "", "Heading 2")]);
      expect(categories(findings)).toEqual(["formatting.emptyHeading", "formatting.emptyHeading"]);
    });

    it("uses paragraph ranges and formatting kind", () => {
      const findings = run([paragraph(4, "Body", "Unknown")]);
      expect(findings[0]?.range).toEqual({ start: 4, end: 5, unit: "paragraph" });
      expect(findings[0]?.kind).toBe("formatting");
    });
  });

  describe("host capabilities", () => {
    it("makes no style claim on a host that will not serve style names", () => {
      const findings = run([paragraph(0, "Body", "Body Text"), paragraph(1, "Body", "")], {
        capabilities: NO_CAPABILITIES,
      });
      expect(categories(findings)).toEqual(["formatting.emptyStyle"]);
    });
  });

  /*
   * The three structural scopes: tables (§10.5), headers/footers and page setup
   * (§8.4, §8.5).
   *
   * Every case below is written in the same shape as the paragraph ones: the
   * same snapshot produces a finding under a profile that configures a standard
   * and nothing under one that does not, and *nothing at all* on a host whose
   * capability is `false`. That third case is the important one. These three
   * families default to `false` everywhere (DD-3), so a check that ran anyway
   * would report a clean table as compliant on a host that never served it.
   */
  describe("structural scopes (spec §8.3–§8.5, §10.5)", () => {
    const STRUCTURAL_CAPABILITIES: FormattingCapabilities = {
      ...CAPABILITIES,
      supportsTables: true,
      supportsHeadersFooters: true,
      supportsSections: true,
    };

    /** Run with a snapshot that also carries the structural collections. */
    function runStructural(
      collections: Partial<Pick<FormattingSnapshot, "tables" | "sections" | "headersFooters">>,
      options: { profile?: ReturnType<typeof profile>; capabilities?: FormattingCapabilities } = {},
    ) {
      return findFormattingIssues({
        snapshot: {
          ...snapshot([]),
          tables: [],
          sections: [],
          headersFooters: [],
          ...collections,
        } as FormattingSnapshot,
        profile: options.profile ?? profile(),
        structure: structure(),
        capabilities: options.capabilities ?? STRUCTURAL_CAPABILITIES,
      });
    }

    const table = (overrides: Record<string, unknown> = {}) => ({
      index: 0,
      nodeId: "table-1",
      sourcePath: "body/table/0",
      text: "A\tB",
      styleName: "Table Grid",
      headerRow: null,
      headerRowCount: null,
      cellStyleName: null,
      rowCount: 2,
      columnCount: 2,
      ...overrides,
    });

    const section = (overrides: Record<string, unknown> = {}) => ({
      index: 0,
      nodeId: "section-1",
      sourcePath: "body/section/0",
      text: "Section text",
      orientation: "portrait" as const,
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      width: 11906,
      height: 16838,
      ...overrides,
    });

    const headerFooter = (overrides: Record<string, unknown> = {}) => ({
      index: 0,
      nodeId: "header-1",
      sourcePath: "body/section/0/header/Primary",
      kind: "header" as const,
      text: "Quarterly report",
      styleName: "Header",
      required: true,
      font: {
        name: "Calibri",
        size: 9,
        color: "#000000",
        bold: false,
        italic: false,
        underline: false,
      },
      ...overrides,
    });

    const tableProfile = () =>
      profile({ tables: { styleName: "Table Normal", headerRowCount: 2, supported: true } });

    describe("tables (spec §10.5)", () => {
      it("reports a table style the profile did not name", () => {
        const findings = runStructural({ tables: [table()] }, { profile: tableProfile() });
        expect(categories(findings)).toContain("formatting.tableStyle");
        const finding = findings.find(
          (f) => f.deterministic?.profilePath === "formatting.tables.styleName",
        );
        expect(finding?.message).toMatch(/"Table Grid" but the profile expects "Table Normal"/);
      });

      it("says nothing about a table when the profile configures no table standard", () => {
        // A profile that has not looked at tables has not decided they are wrong.
        const findings = runStructural({ tables: [table()] });
        expect(categories(findings)).not.toContain("formatting.tableStyle");
      });

      it("reports nothing at all on a host that will not serve tables", () => {
        const findings = runStructural(
          { tables: [table()] },
          {
            profile: tableProfile(),
            capabilities: { ...STRUCTURAL_CAPABILITIES, supportsTables: false },
          },
        );
        expect(categories(findings)).not.toContain("formatting.tableStyle");
      });

      it("says nothing about a table property the host never read", () => {
        // `headerRow` and `cellStyleName` have no member on `Word.Table`'s load
        // options, so acquisition reports them as `null` and the check is skipped
        // rather than comparing an absent value against the profile's.
        const findings = runStructural(
          {
            tables: [
              table({
                styleName: "Table Normal",
                headerRow: null,
                cellStyleName: null,
                rowCount: 2,
              }),
            ],
          },
          { profile: tableProfile() },
        );
        expect(categories(findings)).not.toContain("formatting.tableStyle");
      });

      it("compares the header-row count the host did read", () => {
        const findings = runStructural(
          { tables: [table({ styleName: "Table Normal", headerRowCount: 1 })] },
          { profile: tableProfile() },
        );
        expect(
          findings.some((f) => f.deterministic?.profilePath === "formatting.tables.headerRowCount"),
        ).toBe(true);
      });

      it("never offers a correction, because no table mutation is verified", () => {
        // Spec §8.3: table mutation is refused rather than guessed at, so a
        // finding here is advisory. An "Approve" that Apply would drop is worse
        // than no Approve.
        const findings = runStructural({ tables: [table()] }, { profile: tableProfile() });
        findings
          .filter((f) => f.category === "formatting.tableStyle")
          .forEach((finding) => {
            expect(finding.deterministic?.correctionAvailable).toBe(false);
            expect(finding.deterministic?.correctionReason).toMatch(/table/i);
          });
      });
    });

    describe("headers and footers (spec §8.4)", () => {
      const headerProfile = () =>
        profile({ headersFooters: { styleName: "Header", required: true, supported: true } });

      it("reports a header carrying a style the profile did not name", () => {
        const findings = runStructural(
          { headersFooters: [headerFooter({ styleName: "Normal" })] },
          { profile: headerProfile() },
        );
        const finding = findings.find(
          (f) => f.deterministic?.profilePath === "formatting.headersFooters.styleName",
        );
        expect(finding?.message).toMatch(/header carries "Normal"/);
      });

      it("reports a missing header when the profile requires one", () => {
        // `required` is presence: Word serves a blank body for a header the
        // document does not have, so a blank is the only evidence of absence.
        const findings = runStructural(
          { headersFooters: [headerFooter({ text: "", required: false, styleName: "Header" })] },
          { profile: headerProfile() },
        );
        expect(
          findings.some(
            (f) => f.deterministic?.profilePath === "formatting.headersFooters.required",
          ),
        ).toBe(true);
      });

      it("compares the font properties the host read", () => {
        const findings = runStructural(
          { headersFooters: [headerFooter({ font: { name: "Arial", size: 9 } })] },
          {
            profile: profile({
              headersFooters: { font: { name: "Calibri", size: 9 }, supported: true },
            }),
          },
        );
        expect(
          findings.some(
            (f) => f.deterministic?.profilePath === "formatting.headersFooters.font.name",
          ),
        ).toBe(true);
        // Size matches, so it is not a finding of its own.
        expect(
          findings.some(
            (f) => f.deterministic?.profilePath === "formatting.headersFooters.font.size",
          ),
        ).toBe(false);
      });

      it("reports nothing at all on a host that will not serve headers", () => {
        const findings = runStructural(
          { headersFooters: [headerFooter({ styleName: "Normal" })] },
          {
            profile: headerProfile(),
            capabilities: { ...STRUCTURAL_CAPABILITIES, supportsHeadersFooters: false },
          },
        );
        expect(categories(findings)).not.toContain("formatting.headerFooter");
      });
    });

    describe("page setup (spec §8.5)", () => {
      const pageProfile = () => profile({ page: { orientation: "landscape", supported: true } });

      it("reports an orientation the profile did not ask for", () => {
        const findings = runStructural({ sections: [section()] }, { profile: pageProfile() });
        expect(categories(findings)).toContain("formatting.pageSetup");
        expect(findings[0]?.message).toMatch(
          /orientation is portrait but the profile expects landscape/,
        );
      });

      it("says nothing on a host with no page setup, which is Word on the web", () => {
        // `Section.pageSetup` is WordApiDesktop 1.3. A web host serves the section
        // and refuses the geometry, and the geometry reads as `null`.
        const findings = runStructural(
          { sections: [section({ orientation: null, margins: {}, width: null, height: null })] },
          { profile: pageProfile() },
        );
        expect(categories(findings)).not.toContain("formatting.pageSetup");
      });

      it("reports nothing at all on a host that will not serve sections", () => {
        const findings = runStructural(
          { sections: [section()] },
          {
            profile: pageProfile(),
            capabilities: { ...STRUCTURAL_CAPABILITIES, supportsSections: false },
          },
        );
        expect(categories(findings)).not.toContain("formatting.pageSetup");
      });

      it("compares each margin edge separately, so a group is one remedy", () => {
        const findings = runStructural(
          { sections: [section({ margins: { top: 72, bottom: 36, left: 72, right: 72 } })] },
          { profile: profile({ page: { margins: { bottom: 72 }, supported: true } }) },
        );
        const marginFindings = findings.filter(
          (f) => f.deterministic?.profilePath === "formatting.page.margins.bottom",
        );
        expect(marginFindings).toHaveLength(1);
        expect(marginFindings[0]?.message).toMatch(/Page margin bottom is 36/);
      });
    });
  });
});
