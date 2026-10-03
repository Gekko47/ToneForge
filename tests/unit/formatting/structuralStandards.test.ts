import { describe, expect, it } from "vitest";
import {
  familiesNotEnabled,
  standardIsChecked,
  standardIsEnabled,
  standardIsRequested,
  STRUCTURAL_STANDARD_CAPABILITY,
  STRUCTURAL_STANDARD_FAMILIES,
  STRUCTURAL_STANDARD_LABELS,
  type StructuralStandardCapabilities,
} from "../../../src/formatting/structuralStandards";
import {
  HeaderFooterStandardSchema,
  ListFormattingStandardSchema,
  PageStandardSchema,
  TableFormattingStandardSchema,
} from "../../../src/core/domain/StyleProfile";

const ALL: StructuralStandardCapabilities = {
  supportsListLevel: true,
  supportsTables: true,
  supportsHeadersFooters: true,
  supportsSections: true,
};

const NONE: StructuralStandardCapabilities = {
  supportsListLevel: false,
  supportsTables: false,
  supportsHeadersFooters: false,
  supportsSections: false,
};

describe("structural standards: a house decision and a host fact, kept apart", () => {
  it("reads `requested` off the profile and nothing else", () => {
    expect(standardIsRequested({ requested: true })).toBe(true);
    expect(standardIsRequested({ requested: false })).toBe(false);
    // A standard that was never authored and a standard nobody asked for must
    // behave identically: neither is checked, and neither is a host claim.
    expect(standardIsRequested(undefined)).toBe(false);
    expect(standardIsRequested({})).toBe(false);
  });

  it("reads `enabled` off the probed capability and nothing else", () => {
    STRUCTURAL_STANDARD_FAMILIES.forEach((family) => {
      expect(standardIsEnabled(family, ALL)).toBe(true);
      expect(standardIsEnabled(family, NONE)).toBe(false);
    });
  });

  /*
   * The defect this module closes. `supported` was a user-set boolean, so the
   * profile could assert a property of the host. The renamed field must not be
   * able to do that: setting `requested` on every standard cannot make a
   * standard readable, because the host half still decides.
   */
  it("cannot be made checked by authoring alone on a host that cannot read it", () => {
    STRUCTURAL_STANDARD_FAMILIES.forEach((family) => {
      expect(standardIsChecked(family, { requested: true }, NONE)).toBe(false);
    });
  });

  it("cannot be made checked by the host alone when the house did not ask", () => {
    STRUCTURAL_STANDARD_FAMILIES.forEach((family) => {
      expect(standardIsChecked(family, { requested: false }, ALL)).toBe(false);
      expect(standardIsChecked(family, undefined, ALL)).toBe(false);
    });
  });

  it("is checked only where both halves hold", () => {
    STRUCTURAL_STANDARD_FAMILIES.forEach((family) => {
      expect(standardIsChecked(family, { requested: true }, ALL)).toBe(true);
    });
  });

  it("maps each family to the capability that actually governs it", () => {
    // A wrong key here would let a table standard be gated on header support,
    // which is exactly the two-answers-one-question defect this replaces.
    expect(STRUCTURAL_STANDARD_CAPABILITY).toEqual({
      lists: "supportsListLevel",
      tables: "supportsTables",
      headersFooters: "supportsHeadersFooters",
      page: "supportsSections",
    });
  });

  it("treats an absent capability as not enabled, never as assumed yes", () => {
    // `supportsTables` is optional precisely so a host that never claimed it
    // cannot be read as supporting it. `undefined` is not `true`.
    expect(standardIsEnabled("tables", { supportsListLevel: true })).toBe(false);
    expect(standardIsChecked("tables", { requested: true }, { supportsListLevel: true })).toBe(
      false,
    );
  });
});

describe("familiesNotEnabled: what the editor marks", () => {
  it("names every family a host cannot read", () => {
    expect(familiesNotEnabled(NONE)).toEqual([...STRUCTURAL_STANDARD_FAMILIES]);
    expect(familiesNotEnabled(ALL)).toEqual([]);
  });

  it("names only the missing half on a partially capable host", () => {
    const partial: StructuralStandardCapabilities = {
      supportsListLevel: true,
      supportsTables: false,
      supportsHeadersFooters: true,
      supportsSections: false,
    };
    expect(familiesNotEnabled(partial)).toEqual(["tables", "page"]);
  });

  /*
   * `null` is "the probe has not answered", which is a third state and not
   * `false`. Marking every standard unreadable before the probe ran would be a
   * claim about the host nobody made.
   */
  it("marks nothing at all before the probe has answered", () => {
    expect(familiesNotEnabled(null)).toEqual([]);
  });

  it("gives every family a label and a reason in the reader's words", () => {
    STRUCTURAL_STANDARD_FAMILIES.forEach((family) => {
      const entry = STRUCTURAL_STANDARD_LABELS[family];
      expect(entry.label.length).toBeGreaterThan(0);
      // The reason has to say what will not happen, or the note is decoration.
      expect(entry.reason).toMatch(/not compared|never compared/);
    });
  });

  it("names a family in the same words its own toggle uses", () => {
    // The toggle says "tables"; the note must not say "Table style" or
    // "Table formatting", or the two surfaces describe one thing differently.
    expect(STRUCTURAL_STANDARD_LABELS.tables.label).toBe("Tables");
    expect(STRUCTURAL_STANDARD_LABELS.headersFooters.label).toBe("Headers and footers");
    expect(STRUCTURAL_STANDARD_LABELS.page.label).toBe("Page setup");
  });
});

describe("the four profile schemas carry `requested`, not `supported`", () => {
  const schemas = [
    ["lists", ListFormattingStandardSchema],
    ["tables", TableFormattingStandardSchema],
    ["headersFooters", HeaderFooterStandardSchema],
    ["page", PageStandardSchema],
  ] as const;

  schemas.forEach(([name, schema]) => {
    it(`${name} defaults to not requested, so an older record starts silent`, () => {
      const parsed: Readonly<Record<string, unknown>> = schema.parse({});
      expect(parsed.requested).toBe(false);
      expect("supported" in parsed).toBe(false);
    });

    it(`${name} accepts an explicit request`, () => {
      expect(schema.parse({ requested: true }).requested).toBe(true);
    });

    /*
     * A stored profile written under the old schema carries `supported`. Zod
     * strips it, so the standard arrives not-requested and silent rather than
     * arriving with a claim this host never made. That is the safe direction,
     * and it is why no migration is needed for the field's absence.
     */
    it(`${name} drops a legacy "supported" key instead of honouring it`, () => {
      const parsed: Readonly<Record<string, unknown>> = schema.parse({ supported: true });
      expect(parsed.requested).toBe(false);
      expect("supported" in parsed).toBe(false);
    });
  });

  it("keeps `required` on the header standard, which is a house decision", () => {
    const parsed = HeaderFooterStandardSchema.parse({ required: true, requested: true });
    expect(parsed.required).toBe(true);
    expect(parsed.requested).toBe(true);
  });
});
