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
  supportsRangedReplacement: true,
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

  it("authors all three vocabularies, and says which record each one writes", () => {
    /*
     * Terminology was relocated here from the governance policy page, where two
     * of the three fields were read by nothing at all. Asserting the three
     * controls exist is the minimum; asserting each one *labels its record* is
     * what stops the section from silently becoming a second, competing
     * vocabulary store.
     *
     * **Two editors of one record, on purpose.** The House style form offers the
     * compact `term: replacement` view; this section offers the per-rule view.
     * Both write `language.terminology` (ADR-0110), so there is one record and one
     * engine behind them.
     *
     * This was not always true. `houseStyle.preferredTerminology` and
     * `houseStyle.bannedTerms` were a second pair of fields that validated,
     * persisted, and produced **nothing** — the registry filtered both checks out
     * of `findHouseStyleIssues` in favour of these rules. That is ND-13. Those
     * fields and checks are gone, and the House style form was re-pointed here
     * rather than deleted, so the capability a user had is preserved and finally
     * wired.
     */
    renderSections(CAPABLE);

    expect(screen.getByRole("heading", { name: "Preferred terminology" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Banned terms" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Required terms" })).toBeInTheDocument();
    /*
     * Of the three vocabularies only the banned list is a multi-line control: it
     * is genuinely a flat list. Preferred and required terms are rule objects and
     * get a row each, because a line format cannot express
     * wholeWord/caseSensitive/severity. The section is therefore not three
     * identical textareas.
     *
     * Stated per control rather than as a page-wide `<textarea>` count. The page
     * grew other textareas when the language conventions got their editors, and a
     * bare count would then be asserting something about *those* instead — which is
     * how a test silently stops testing the thing it was written for.
     */
    expect(screen.getByLabelText("Banned terms").tagName).toBe("TEXTAREA");
    expect(
      screen.queryByRole("textbox", { name: /Preferred terminology/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Required terms/ })).not.toBeInTheDocument();
  });

  it("writes a preferred-term edit through to language.terminology", () => {
    const { onChange } = renderSections(CAPABLE);
    fireEvent.click(screen.getByRole("button", { name: "Add preferred term" }));

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;
    expect(last.language.terminology).toHaveLength(1);
    expect(last.language.terminology[0]?.id).toBe("term-1");
    // The new row is not saved as an empty term; it carries a draft source so
    // the schema parses and the user has something to overwrite.
    expect(last.language.terminology[0]?.source).toBe("term");
  });

  it("refuses to commit a term the schema will not accept, and keeps the last good one", () => {
    /*
     * `source` cannot be blank, so a half-typed term must not throw inside a
     * keystroke. The pane going down because somebody pressed backspace is the
     * worst possible outcome for a form field.
     */
    const { onChange } = renderSections(CAPABLE);
    fireEvent.click(screen.getByRole("button", { name: "Add preferred term" }));
    onChange.mockClear();

    // The Term field specifically: the new row also seeds a Replacement of
    // "term", so a bare display-value query matches both.
    fireEvent.change(screen.getByLabelText("Term"), { target: { value: "" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("A term cannot be blank.")).toBeInTheDocument();
  });

  it("writes a required-term edit through to language.requiredTerms", () => {
    const { onChange } = renderSections(CAPABLE);
    fireEvent.click(screen.getByRole("button", { name: "Add required term" }));

    const last = onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;
    expect(last.language.requiredTerms).toHaveLength(1);
    // A required term has no replacement: there is no correct text to insert.
    expect(last.language.requiredTerms[0]).not.toHaveProperty("replacement");
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

  /*
   * The language conventions that had no control at all.
   *
   * Abbreviations, numbers, dates, currency and units were all declared in the
   * schema, read by registered rules, and named in a rule's `profilePaths` — so the
   * registry reported every one of them as wired. Nothing in the product could
   * *write* them, which the registry cannot see: it can see that a rule reads a
   * field, never that a control writes one. In the running product they all sat at
   * their schema defaults and no rule in those subsections could fire.
   *
   * These tests are therefore about reachability, not appearance. Each one drives
   * a control and asserts the field the rule reads actually changed.
   */
  describe("every language convention has a control that writes it", () => {
    const lastProfile = (onChange: ReturnType<typeof vi.fn>): DeterministicStyleProfile =>
      onChange.mock.calls.at(-1)?.[0] as DeterministicStyleProfile;

    it("writes the approved abbreviation list", () => {
      const { onChange } = renderSections(CAPABLE);
      fireEvent.change(screen.getByLabelText(/Approved abbreviations/), {
        target: { value: "e.g.: for example" },
      });

      expect(lastProfile(onChange).language.abbreviations.approved).toEqual({
        "e.g.": "for example",
      });
    });

    it("writes the preferred short form, which the rule now reads", () => {
      const { onChange } = renderSections(CAPABLE);
      fireEvent.change(screen.getByLabelText(/Preferred short form/), {
        target: { value: "for example: e.g." },
      });

      expect(lastProfile(onChange).language.abbreviations.preferredExpanded).toEqual({
        "for example": "e.g.",
      });
    });

    it("reports a malformed abbreviation line in the field's own vocabulary", () => {
      renderSections(CAPABLE);
      fireEvent.change(screen.getByLabelText(/Preferred short form/), {
        target: { value: "for example" },
      });

      // Not "Terminology line 1" — this field is not a terminology field, and
      // telling a user their approved abbreviation must use "term: replacement"
      // describes a different editor than the one they are looking at.
      expect(
        screen.getByText('Preferred short form line 1 must use "long form: short form".'),
      ).toBeInTheDocument();
    });

    it("offers three states for the expansion requirement, not two", () => {
      renderSections(CAPABLE);
      const select = screen.getByLabelText("Expansion on first use") as HTMLSelectElement;

      // A checkbox cannot say "the house has not decided", and collapsing three
      // states into two is how an unanswered question reads as a yes.
      expect([...select.options].map((option) => option.value)).toEqual(["", "true", "false"]);
    });

    it("stores the expansion requirement as false, not as absent", () => {
      const { onChange } = renderSections(CAPABLE);
      fireEvent.change(screen.getByLabelText("Expansion on first use"), {
        target: { value: "false" },
      });

      // "Not required" is a decision. Writing `undefined` instead would record it
      // as "not configured", which is the answer the schema exists to distinguish.
      expect(lastProfile(onChange).language.abbreviations).toHaveProperty(
        "requireFirstUseExpansion",
        false,
      );
    });

    it("writes the banned variant list", () => {
      const { onChange } = renderSections(CAPABLE);
      fireEvent.change(screen.getByLabelText(/Forms that must never appear/), {
        target: { value: "etc.\nNB" },
      });

      expect(lastProfile(onChange).language.abbreviations.prohibitedVariants).toEqual([
        "etc.",
        "NB",
      ]);
    });

    it("writes the proper-noun and prohibited-capital lists", () => {
      const { onChange } = renderSections(CAPABLE);
      fireEvent.change(screen.getByLabelText(/Proper nouns/), {
        target: { value: "ToneForge" },
      });
      expect(lastProfile(onChange).language.capitalisation.properNouns).toEqual(["ToneForge"]);

      fireEvent.change(screen.getByLabelText(/must never be capitalised/), {
        target: { value: "programme" },
      });
      expect(lastProfile(onChange).language.capitalisation.prohibitedCapitalised).toEqual([
        "programme",
      ]);
    });

    it("writes the number conventions", () => {
      const { onChange } = renderSections(CAPABLE);
      fireEvent.change(screen.getByLabelText(/Percent sign/), { target: { value: "space" } });
      expect(lastProfile(onChange).language.numbers.percentageSpacing).toBe("space");

      fireEvent.change(screen.getByLabelText(/Negative numbers/), {
        target: { value: "parenthesis" },
      });
      expect(lastProfile(onChange).language.numbers.negativeNumber).toBe("parenthesis");

      fireEvent.change(screen.getByLabelText("Ranges"), { target: { value: "to" } });
      expect(lastProfile(onChange).language.numbers.rangeStyle).toBe("to");
    });

    it("treats a cleared number threshold as never, not as zero", () => {
      const seeded = DeterministicStyleProfileSchema.parse({
        formatting: { bodyStyle: { styleName: "Normal" } },
        language: { numbers: { numberWordThreshold: 10 } },
      });
      const { onChange } = renderSections(CAPABLE, seeded);
      fireEvent.change(screen.getByLabelText(/Spell out numbers up to/), {
        target: { value: "" },
      });

      // `0` would be "spell out every number", a rule the profile never chose.
      expect(lastProfile(onChange).language.numbers.numberWordThreshold).toBeNull();
    });

    it("adds a date format seeded from the locale, and makes the first one preferred", () => {
      const { onChange } = renderSections(CAPABLE);
      fireEvent.click(screen.getByRole("button", { name: "Add date format" }));

      const formats = lastProfile(onChange).language.dates.formats;
      expect(formats).toEqual([{ id: "mdy", format: "M/D/YYYY", preferred: true }]);
    });

    it("offers only the shapes the rule can recognise", () => {
      renderSections(CAPABLE);
      fireEvent.click(screen.getByRole("button", { name: "Add date format" }));

      const shape = screen.getByLabelText("Shape") as HTMLSelectElement;
      expect([...shape.options].map((option) => option.value)).toEqual([
        "year-first",
        "day-month-year",
        "dmy",
        "mdy",
        "numeric",
      ]);
      // "unrecognised" is what the rule says when it could not read a shape. A
      // profile must not be able to prefer it.
      expect([...shape.options].map((option) => option.value)).not.toContain("unrecognised");
    });

    it("keeps exactly one date format preferred", () => {
      const seeded = DeterministicStyleProfileSchema.parse({
        formatting: { bodyStyle: { styleName: "Normal" } },
        language: {
          dates: {
            formats: [
              { id: "dmy", format: "DD/MM/YYYY", preferred: true },
              { id: "mdy", format: "M/D/YYYY", preferred: false },
            ],
          },
        },
      });
      const { onChange } = renderSections(CAPABLE, seeded);
      const preferred = screen.getAllByLabelText(
        "This is the shape new dates should be written in",
      );
      fireEvent.click(preferred[1] as HTMLElement);

      // The rule takes the *first* preferred format, so two of them is an answer
      // that depends on the order of an array the user never sees ordered.
      expect(
        lastProfile(onChange).language.dates.formats.map((format) => format.preferred),
      ).toEqual([false, true]);
    });

    it("writes the currency conventions that this profile owns", () => {
      const { onChange } = renderSections(CAPABLE);
      fireEvent.change(screen.getByLabelText(/Amounts are written with/), {
        target: { value: "code" },
      });
      expect(lastProfile(onChange).language.currency.representation).toBe("code");

      fireEvent.change(screen.getByLabelText(/How large amounts are written/), {
        target: { value: "millions" },
      });
      expect(lastProfile(onChange).language.currency.magnitude).toBe("millions");
    });

    it("offers no currency separator control, because typography owns both", () => {
      renderSections(CAPABLE);
      /*
       * A second control for the same characters is the two-owners defect ND-2
       * describes. `typography` reports the comma in `£1,000` document-wide; a
       * currency-scoped owner reporting the same comma would put two changes over
       * one offset and let the planner refuse the whole plan.
       */
      expect(screen.queryByLabelText("Thousands separator")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Decimal separator")).not.toBeInTheDocument();
    });

    it("writes the unit conventions, including the preferred symbol D4 added", () => {
      const { onChange } = renderSections(CAPABLE);
      fireEvent.change(screen.getByLabelText(/Preferred symbol/), {
        target: { value: "kilogram: kg" },
      });

      expect(lastProfile(onChange).language.units.symbols).toEqual({ kilogram: "kg" });
    });

    it("no longer points a user at a panel that does not hold these fields", () => {
      renderSections(CAPABLE);
      // The old sentence claimed the number, date, currency and unit conventions
      // were "set in the House style panel". They are set here, and a sentence that
      // sends a user looking in the wrong place is a claim the product cannot keep.
      expect(screen.queryByText(/are set in the House style panel/)).not.toBeInTheDocument();
    });
  });
});
