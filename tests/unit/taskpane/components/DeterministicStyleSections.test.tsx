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

  it("marks a section the host cannot read, rather than letting it look like a working one", () => {
    renderSections(NO_TABLES);
    expect(screen.getByText("Not checked in this Word version")).toBeInTheDocument();
    expect(screen.getByText(/cannot read table properties/)).toBeInTheDocument();
  });

  it("carries the marking in the collapsed header, where a user would not see it in the body", () => {
    // The whole point of putting it in the summary: a collapsed section is
    // exactly the case where a note in the body would go unread.
    const { container } = renderSections(NO_TABLES);
    const summary = container.querySelector(".tf-profile-section-unsupported");
    expect(summary?.closest("summary")).not.toBeNull();
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
