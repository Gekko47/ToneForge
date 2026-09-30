import { describe, expect, it } from "vitest";
import { planAcquisitionLoads } from "../../../src/word/analysisAcquisition";
import type { AnalysisCapabilities } from "../../../src/analysis/analysisContext";

const ALL_ON: AnalysisCapabilities = {
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
  hostVersion: "16",
};

describe("planAcquisitionLoads", () => {
  it("asks for everything on a fully capable host", () => {
    const plan = planAcquisitionLoads(ALL_ON);
    expect(plan.styleCollection).toBe(true);
    expect(plan.skipped).toEqual([]);
    expect(plan.paragraphProperties).toContain("style");
    expect(plan.paragraphProperties).toContain("alignment");
    expect(plan.paragraphProperties).toContain("font");
    expect(plan.paragraphProperties).toContain("isListItem");
  });

  it("never asks for a property the host has declared it cannot serve", () => {
    // The live Desktop Word probe: styles and paragraph format are absent.
    const plan = planAcquisitionLoads({
      ...ALL_ON,
      supportsStyles: false,
      supportsParagraphFormat: false,
    });
    expect(plan.styleCollection).toBe(false);
    expect(plan.skipped).toContain("styles");
    expect(plan.skipped).toContain("alignment");
    expect(plan.skipped).toContain("style");
    expect(plan.paragraphProperties).not.toContain("alignment");
    expect(plan.paragraphProperties).not.toContain("style");
    // Text is the floor of every scope and is never withheld.
    expect(plan.paragraphProperties).toContain("text");
  });

  it("keeps the character-format family separate from paragraph format", () => {
    const plan = planAcquisitionLoads({ ...ALL_ON, supportsParagraphFormat: false });
    expect(plan.paragraphProperties).toContain("font");
    expect(plan.paragraphProperties).not.toContain("lineSpacing");
  });

  /*
   * Indentation and the three flow controls arrive with the paragraph-format
   * family. Loading them separately would be a second transaction for one
   * paragraph, and Word serves them or refuses them together.
   */
  it("asks for indentation and the flow controls with the paragraph-format family", () => {
    const plan = planAcquisitionLoads(ALL_ON);
    [
      "leftIndent",
      "rightIndent",
      "firstLineIndent",
      "keepNext",
      "keepLines",
      "pageBreakBefore",
    ].forEach((property) => {
      expect(plan.paragraphProperties).toContain(property);
    });
  });

  it("withholds the flow controls from a host without paragraph format", () => {
    const plan = planAcquisitionLoads({ ...ALL_ON, supportsParagraphFormat: false });
    ["leftIndent", "keepNext", "pageBreakBefore"].forEach((property) => {
      expect(plan.paragraphProperties).not.toContain(property);
    });
  });

  it("drops every optional property in the degraded scope", () => {
    const plan = planAcquisitionLoads(ALL_ON, true);
    expect(plan.styleCollection).toBe(false);
    expect(plan.paragraphProperties).toEqual(["text", "uniqueLocalId"]);
    expect(plan.skipped).toContain("font");
    expect(plan.skipped).toContain("styles");
  });
});
