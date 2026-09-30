import { describe, expect, it } from "vitest";
import { planAcquisitionLoads } from "../../../src/word/analysisAcquisition";
import type { AnalysisCapabilities } from "../../../src/analysis/analysisContext";

/**
 * Every capability a host can be probed for, all `true`.
 *
 * The three structural families are `true` here, which is the point: this is the
 * fully-capable host, and the one test that asserts nothing is skipped can only
 * say so on a host that serves tables, sections and headers. They default to
 * `false` in production (DD-3) because no host has been proven to serve them, and
 * `skippedScopes` below is the separate fixture for the host that has not.
 */
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
  supportsTables: true,
  supportsHeadersFooters: true,
  supportsSections: true,
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

  /*
   * Spec §9 and gate 23: a host gap is reported, not guessed around.
   *
   * The three families default to `false` at every call site, so until a probe
   * proves otherwise this is the shape of every real scan. Acquisition must
   * name each one as skipped and must not ask for it — and the load plan is the
   * only place that decision is made, so this is where it is pinned.
   */
  it("names every structural family a host does not declare, and asks for none of them", () => {
    const plan = planAcquisitionLoads({
      ...ALL_ON,
      supportsTables: false,
      supportsHeadersFooters: false,
      supportsSections: false,
    });
    expect(plan.tableCollection).toBe(false);
    expect(plan.sectionCollection).toBe(false);
    expect(plan.headerFooterCollection).toBe(false);
    expect(plan.skipped).toContain("tables");
    expect(plan.skipped).toContain("sections");
    // Reported separately: a missing header collection is a host limitation,
    // while a missing footer one shares the capability but not the remedy.
    expect(plan.skipped).toContain("headers");
    expect(plan.skipped).toContain("footers");
  });

  it("does not read a header or footer when sections themselves are unreadable", () => {
    // A header is reachable only through `Section.getHeader`, so a host that
    // serves `supportsHeadersFooters` but not `supportsSections` cannot be asked
    // for one. Reporting headers as served here would be a coverage claim with
    // no read behind it.
    const plan = planAcquisitionLoads({ ...ALL_ON, supportsSections: false });
    expect(plan.sectionCollection).toBe(false);
    expect(plan.headerFooterCollection).toBe(false);
    expect(plan.skipped).toContain("headers");
  });

  it("treats a structural scope the policy switched off as not wanted", () => {
    // The policy decides whether a scope is *wanted*; the capability decides
    // whether the host can serve it. Both are recorded, and conflating them
    // sends the reader to a setting that will not help.
    const plan = planAcquisitionLoads(ALL_ON, false, {
      includeBody: true,
      includeLists: true,
      includeTables: false,
      includeSections: true,
      includeHeadersFooters: false,
    } as Parameters<typeof planAcquisitionLoads>[2]);
    expect(plan.tableCollection).toBe(false);
    expect(plan.sectionCollection).toBe(true);
    expect(plan.headerFooterCollection).toBe(false);
    expect(plan.skipped).toContain("tables");
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
   * Indentation arrives with the paragraph-format family. Loading them
   * separately would be a second transaction for one paragraph, and Word serves
   * them or refuses them together.
   *
   * The flow controls are *not* requested at all. `keepNext`/`keepLines` belong
   * to `Word.ParagraphFormat`, and `Word.Paragraph` has no `paragraphFormat`
   * property to reach them through — so a request naming one is a request for a
   * property the host does not have, which it answers by rejecting the whole
   * call and costing every property in this family.
   */
  it("asks for indentation with the paragraph-format family and no flow controls", () => {
    const plan = planAcquisitionLoads(ALL_ON);
    ["leftIndent", "rightIndent", "firstLineIndent"].forEach((property) => {
      expect(plan.paragraphProperties).toContain(property);
    });
    // No undocumented name may reappear, including `paragraphFormat`: a request
    // carrying any of them is the one that costs the whole family.
    ["keepNext", "keepLines", "pageBreakBefore", "paragraphFormat"].forEach((property) => {
      expect(plan.paragraphProperties).not.toContain(property);
    });
  });

  it("withholds the flow controls from a host without paragraph format", () => {
    const plan = planAcquisitionLoads({ ...ALL_ON, supportsParagraphFormat: false });
    ["leftIndent", "rightIndent", "firstLineIndent"].forEach((property) => {
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
