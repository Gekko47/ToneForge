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
    });

    it("does not flag a list level on a list style", () => {
      const findings = run([
        { ...paragraph(0, "An item"), styleName: "List Bullet", listLevel: 1 },
      ]);
      expect(categories(findings)).not.toContain("formatting.listLevel");
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
});
