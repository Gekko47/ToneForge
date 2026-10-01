/**
 * The deterministic profile sections (spec §21).
 *
 * The load-bearing case is the unsupported marking. A user who sets a table
 * style, never sees a table finding, and concludes the document complies — when
 * the table was never examined — is the false-compliance claim §9 exists to
 * prevent, reproduced one level up in the editor. The rest of the file pins the
 * progressive disclosure and the round-tripping, which are what make the
 * four-section IA usable rather than merely present.
 */

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DeterministicStyleSections from "../../../../src/taskpane/components/DeterministicStyleSections";
import { DeterministicStyleProfileSchema } from "../../../../src/core/domain/StyleProfile";
import type { DeterministicStyleProfile } from "../../../../src/core/domain/StyleProfile";
import type { WordCapabilities } from "../../../../src/word/capabilityProbe";

const BASE = DeterministicStyleProfileSchema.parse({
  formatting: { bodyStyle: { styleName: "Normal" } },
});

const CAPABLE: WordCapabilities = {
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
  supportsRibbonUpdate: true,
  supportsTables: true,
  supportsHeadersFooters: true,
  supportsSections: true,
  hostName: "Word",
  hostVersion: "16.0",
};

const NO_TABLES: WordCapabilities = { ...CAPABLE, supportsTables: false };

/**
 * Render the sections with the profile held in state.
 *
 * The component is controlled — it renders `profile` and reports an edit — so
 * driving it against a bare `vi.fn()` types each character and sees the original
 * value come straight back. A user does not experience that, because the editor
 * above re-projects the change on every keystroke, and the wrapper is what makes
 * the test exercise the same loop the product does.
 */
function Harness({
  capabilities,
  initial,
  onChange,
}: {
  capabilities: WordCapabilities | null;
  initial: DeterministicStyleProfile;
  onChange: (next: DeterministicStyleProfile) => void;
}): React.ReactNode {
  const [profile, setProfile] = React.useState(initial);
  return (
    <DeterministicStyleSections
      profile={profile}
      capabilities={capabilities}
      onChange={(next) => {
        setProfile(next);
        onChange(next);
      }}
    />
  );
}

function renderSections(
  capabilities: WordCapabilities | null,
  profile: DeterministicStyleProfile = BASE,
  onChange = vi.fn(),
) {
  return {
    onChange,
    ...render(<Harness capabilities={capabilities} initial={profile} onChange={onChange} />),
  };
}

describe("DeterministicStyleSections", () => {
  it("presents the four deterministic sections, each collapsible", () => {
    renderSections(CAPABLE);
    ["Language", "Typography", "Document formatting", "Document structure"].forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });
    // `<details>` rather than a hand-rolled disclosure, so the open state and the
    // keyboard behaviour are the browser's.
    const { container } = renderSections(CAPABLE);
    expect(container.querySelectorAll("details")).toHaveLength(4);
  });

  it("opens the language section and leaves the rest closed", () => {
    const { container } = renderSections(CAPABLE);
    const sections = [...container.querySelectorAll("details")];
    expect(sections[0]?.open).toBe(true);
    expect(sections[1]?.open).toBe(false);
  });

  it("says what each section decides, so a collapsed one is not a mystery", () => {
    renderSections(CAPABLE);
    expect(screen.getByText(/Terminology, capitalisation, abbreviations/)).toBeInTheDocument();
    expect(screen.getByText(/Dashes, quotes, ellipses/)).toBeInTheDocument();
    expect(screen.getByText(/The Word style each paragraph kind must carry/)).toBeInTheDocument();
    expect(screen.getByText(/Whether a skipped heading level/)).toBeInTheDocument();
  });

  it("marks the standards the host cannot read, rather than letting them look checked", () => {
    renderSections(NO_TABLES);
    expect(screen.getByText(/cannot read table properties/)).toBeInTheDocument();
  });

  it("carries the marking in the collapsed header, where a user would not see it in the body", () => {
    // The whole point of putting it in the summary: a collapsed section is
    // exactly the case where a note in the body would go unread.
    const { container } = renderSections(NO_TABLES);
    const summary = container.querySelector(".tf-profile-section-unsupported");
    expect(summary?.closest("summary")).not.toBeNull();
  });

  /*
   * The whole-section marking was a false claim.
   *
   * `Document formatting` governs the body style, the list standard, the table
   * standard, the header standard and page setup. It was marked wholly
   * unsupported from `supportsTables` alone, so on a host with no tables the
   * body-style editor was labelled "Not checked in this Word version" when the
   * body style is the one thing every Word host serves — and conversely, on a
   * host with tables but no page setup, the section said nothing at all about
   * the page-setup editor that could never be checked. Both directions produce
   * a user concluding the wrong thing.
   */
  it("never claims the body style is unchecked, because every host reads it", () => {
    const { onChange } = renderSections(NO_TABLES);
    expect(screen.queryByText("Not checked in this Word version")).not.toBeInTheDocument();
    expect(screen.getByText(/Partly checked/)).toBeInTheDocument();
    // And the editor it claims to be unchecked is still editable and working.
    fireEvent.change(screen.getByLabelText("Body style"), { target: { value: "Body Text" } });
    const last = onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;
    expect(last.formatting.bodyStyle.styleName).toBe("Body Text");
  });

  it("names each standard the host cannot read, in the section that governs it", () => {
    const NOTHING: WordCapabilities = {
      ...CAPABLE,
      supportsListLevel: false,
      supportsTables: false,
      supportsHeadersFooters: false,
      supportsSections: false,
    };
    renderSections(NOTHING);
    const limits = screen.getByLabelText("Not read in this Word version");
    ["List level", "Tables", "Headers and footers", "Page setup"].forEach((label) => {
      expect(within(limits).getByText(`${label}:`)).toBeInTheDocument();
    });
  });

  it("counts the unchecked standards in the header rather than saying 'partly'", () => {
    renderSections(NO_TABLES);
    expect(screen.getByText(/Partly checked — 1 standard not read here/)).toBeInTheDocument();
  });

  it("marks nothing before the capability probe has answered", () => {
    // `null` is "not known yet", not "unsupported". Marking a section before the
    // probe has run would be a claim about the host nobody made.
    renderSections(null);
    expect(screen.queryByText("Not checked in this Word version")).not.toBeInTheDocument();
  });

  it("marks nothing on a host that serves every section", () => {
    renderSections(CAPABLE);
    expect(screen.queryByText("Not checked in this Word version")).not.toBeInTheDocument();
    expect(screen.queryByText(/Partly checked/)).not.toBeInTheDocument();
  });

  /*
   * The structural standards had no control at all.
   *
   * `formatting.lists`, `formatting.tables`, `formatting.headersFooters` and
   * `formatting.page` were declared in the profile schema, read by the analyzer,
   * and wired to registered rules — so the §11 audit reported all four as
   * covered. But nothing in the pane could set them, so at runtime they were
   * always at their schema defaults: `supported: false`, no style name. The
   * table, header/footer and page-setup checks could never produce a finding no
   * matter what a user did. The registry audit cannot see this, because it only
   * checks that a rule reads the field — not that the field is reachable.
   */
  it("offers an editor for every structural standard the rules read", () => {
    renderSections(CAPABLE);
    [
      "List style",
      "List level",
      "Table style",
      "Cell paragraph style",
      "Header and footer style",
      "Orientation",
      "Top margin (points)",
      "Bottom margin (points)",
      "Left margin (points)",
      "Right margin (points)",
    ].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
  });

  it("groups each structural standard so a screen reader is told where a field ends", () => {
    renderSections(CAPABLE);
    ["Lists", "Tables", "Headers and footers", "Page setup"].forEach((legend) => {
      expect(screen.getByText(legend)).toBeInTheDocument();
    });
  });

  /*
   * Four toggles with one accessible name are one toggle.
   *
   * Every structural standard carries a "compare this" switch, and the first
   * version labelled all four identically — so a screen-reader user announcing
   * the list switch heard "Compare this against the document" and had no way to
   * know it was the list switch rather than the page-setup one. Each names what
   * it compares.
   */
  it("names each compare switch after what it compares", () => {
    renderSections(CAPABLE);
    [
      "Compare lists against the document",
      "Compare tables against the document",
      "Compare headers and footers against the document",
      "Compare page setup against the document",
    ].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
  });

  it("writes a list standard that the analyzer will then compare", () => {
    const { onChange } = renderSections(CAPABLE);
    fireEvent.change(screen.getByLabelText("List style"), { target: { value: "List Number" } });
    fireEvent.change(screen.getByLabelText("List level"), { target: { value: "1" } });
    const last = onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;
    expect(last.formatting.lists?.styleName).toBe("List Number");
    expect(last.formatting.lists?.level).toBe(1);
    /*
     * The switch is what makes the check reachable. The analyzer returns nothing
     * unless `supported` is true, so a standard a user set but never switched on
     * would be a setting that changes nothing — the defect the §11 audit exists
     * to catch, reintroduced through the editor.
     */
    fireEvent.click(screen.getByLabelText("Compare lists against the document"));
    const enabled = onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;
    expect(enabled.formatting.lists?.supported).toBe(true);
  });

  it("writes a table standard, so a table check is reachable at all", () => {
    const { onChange } = renderSections(CAPABLE);
    fireEvent.change(screen.getByLabelText("Table style"), { target: { value: "Grid Table" } });
    fireEvent.click(screen.getByLabelText("The first row is a header row"));
    fireEvent.change(screen.getByLabelText("Header rows"), { target: { value: "2" } });
    const last = onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;
    expect(last.formatting.tables?.styleName).toBe("Grid Table");
    expect(last.formatting.tables?.headerRow).toBe(true);
    expect(last.formatting.tables?.headerRowCount).toBe(2);
  });

  it("writes a header/footer standard, so a header check is reachable at all", () => {
    const { onChange } = renderSections(CAPABLE);
    fireEvent.change(screen.getByLabelText("Header and footer style"), {
      target: { value: "Header" },
    });
    fireEvent.click(screen.getByLabelText("Every section must have a header and a footer"));
    const last = onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;
    expect(last.formatting.headersFooters?.styleName).toBe("Header");
    expect(last.formatting.headersFooters?.required).toBe(true);
  });

  it("writes a page-setup standard, so a page check is reachable at all", () => {
    const { onChange } = renderSections(CAPABLE);
    fireEvent.change(screen.getByLabelText("Orientation"), { target: { value: "landscape" } });
    fireEvent.change(screen.getByLabelText("Top margin (points)"), { target: { value: "72" } });
    const last = onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;
    expect(last.formatting.page?.orientation).toBe("landscape");
    expect(last.formatting.page?.margins?.top).toBe(72);
  });

  /*
   * Blank is not zero. Every one of these standards is `optional()`, and "no
   * margin configured" is a different claim from "a zero-point margin" — the
   * analyzer skips an unset field entirely rather than comparing against 0.
   */
  it("removes a field when it is cleared, rather than writing zero", () => {
    const WITH_VALUES = DeterministicStyleProfileSchema.parse({
      formatting: {
        bodyStyle: { styleName: "Normal" },
        lists: { styleName: "List Number", level: 1 },
        tables: { headerRowCount: 2 },
        page: { margins: { top: 72 } },
      },
    });
    const { onChange } = renderSections(CAPABLE, WITH_VALUES);
    fireEvent.change(screen.getByLabelText("List level"), { target: { value: "" } });
    const last = onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;
    expect(last.formatting.lists?.level).toBeUndefined();
    // And the siblings survive: clearing one field must not drop the standard.
    expect(last.formatting.lists?.styleName).toBe("List Number");
  });

  it("leaves a standard untouched when a field the host cannot read is edited", () => {
    // The standard is durable and the host is not, so an edit made on a
    // table-less Word must persist exactly as written and be compared the moment
    // the profile runs against a host that can read it.
    const { onChange } = renderSections(NO_TABLES);
    fireEvent.change(screen.getByLabelText("Table style"), { target: { value: "Grid Table" } });
    const last = onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;
    expect(last.formatting.tables?.styleName).toBe("Grid Table");
  });

  it("still lets a user set a standard the host cannot currently check", () => {
    // The host may be replaced, and the profile is the durable record of the
    // house standard. Blocking the edit would leave a user stuck with whatever
    // default shipped. What is not allowed is the edit looking effective.
    const { onChange } = renderSections(NO_TABLES);
    // A single `change`, not a keystroke sequence: this asserts that the field
    // is *editable*, and typing nine characters one at a time would be testing
    // the harness rather than the affordance.
    fireEvent.change(screen.getByLabelText("Body style"), { target: { value: "Body Text" } });

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;
    expect(last.formatting.bodyStyle.styleName).toBe("Body Text");
  });

  it("leaves terminology to the House style panel rather than duplicating it", () => {
    /*
     * The correction this section records.
     *
     * It originally carried its own "Preferred terminology" box, which
     * duplicated the one in the House style panel directly below: two controls
     * with the same accessible name, editing the same record through two parse
     * paths, and the House style one is the one with the line validation that
     * tells a user their `term: replacement` is malformed. A second editor for
     * terminology is the defect, not the feature.
     */
    const { container } = renderSections(CAPABLE);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    expect(screen.getByText(/set in the House style panel/)).toBeInTheDocument();
  });

  it("carries the capitalisation toggle into the change callback", async () => {
    const { onChange } = renderSections(CAPABLE);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Sentences begin with a capital letter"));
    const last = onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;
    expect(last.language.capitalisation.sentenceCase).toBe(false);
  });

  it("carries the structure toggles into the change callback", async () => {
    const { onChange } = renderSections(CAPABLE);
    const user = userEvent.setup();
    const toggle = within(screen.getByLabelText("Deterministic style sections")).getByLabelText(
      "Report empty headings",
    );
    await user.click(toggle);

    const last = onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;
    expect(last.structure.reportEmptyHeadings).toBe(false);
  });
});
