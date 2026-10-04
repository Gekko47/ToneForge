import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createEmptyProfile, type StyleProfile } from "../../../../src/core/domain/StyleProfile";
import { createEmptySemanticStyleProfile } from "../../../../src/core/domain/SemanticStyleProfile";
import {
  createRecord,
  effectiveProfile,
  updateDraft,
  type ProfileRecord,
} from "../../../../src/core/domain/ProfileRecord";
import ProfileEditor from "../../../../src/taskpane/components/ProfileEditor";
import { sampleTypography } from "../../../fixtures/sampleDocs";

const STAMP = "2024-01-01T00:00:00.000Z";
const SEMANTIC = createEmptySemanticStyleProfile();

const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  loadProfileRecord: vi.fn(),
  saveProfileRecord: vi.fn(),
  createProfileRecord: vi.fn(),
  setActiveProfile: vi.fn(),
  selectAllProfiles: vi.fn(() => [] as unknown[]),
}));

vi.mock("../../../../src/core/state/index", () => ({
  loadState: () => mocks.loadState(),
  loadProfileRecord: (id: string) => mocks.loadProfileRecord(id),
  saveProfileRecord: (record: unknown) => mocks.saveProfileRecord(record),
  createProfileRecord: (name: string, now: string, seed?: unknown) =>
    mocks.createProfileRecord(name, now, seed),
  setActiveProfile: (id: unknown) => mocks.setActiveProfile(id),
}));

vi.mock("../../../../src/core/state/profileSelectors", () => ({
  selectAllProfiles: () => mocks.selectAllProfiles(),
  selectActiveProfile: () => null,
  selectRecordList: () => [],
  selectRecordSummary: () => null,
  selectRevisions: () => [],
}));

function makeProfile(): StyleProfile {
  return {
    ...createEmptyProfile("Saved profile", 1),
    semantic: {
      ...SEMANTIC,
      tone: { ...SEMANTIC.tone, primary: "neutral" },
      formality: { score: 50, label: "" },
      lexicalPreferences: { ...SEMANTIC.lexicalPreferences, toneAvoid: ["very"] },
    },
    typography: sampleTypography(),
    // Wording lives on `language` (ADR-0110); the house-style copy is gone (ND-13).
    // Spread from the empty profile so the section keeps its schema defaults —
    // `language` has eight leaves and this fixture names three of them.
    language: {
      ...createEmptyProfile("Saved profile", 1).language,
      terminology: [
        {
          id: "term-1",
          source: "client",
          replacement: "customer",
          caseSensitive: false,
          wholeWord: true,
          severity: "advisory",
          scope: {},
        },
      ],
      bannedTerms: ["utilize"],
    },
    houseStyle: {
      capitalization: { titleCaseWords: ["ToneForge"] },
      spellingVariant: "en-US",
    },
  };
}

/**
 * A record whose current draft is `current`, replaying `earlier` as prior draft
 * saves so the audit trail carries real revision numbers.
 */
/**
 * A record whose draft is `current`, replaying `earlier` as prior draft saves
 * so the audit trail carries real revision numbers. With no `earlier`, the
 * record has a single revision (the creation).
 */
function makeRecord(current: StyleProfile, earlier: StyleProfile[] = []): ProfileRecord {
  const first = earlier.at(0);
  if (!first) {
    return createRecord(current.id, current.name, STAMP, current);
  }
  let record = createRecord(first.id, first.name, STAMP, first);
  [...earlier.slice(1), current].forEach((snapshot) => {
    const draft = record.draft;
    if (!draft) throw new Error("expected the record to have a draft");
    record = updateDraft(record, { ...draft, ...snapshot }, STAMP).record;
  });
  return record;
}

function makeState(profiles: StyleProfile[]) {
  return {
    version: 7,
    profileRecords: {},
    activeProfileId: profiles[0]?.id ?? null,
    settings: { telemetryDisabled: true },
  };
}

/** Wire the record store and profile list the editor reads from. */
function installRecords(records: ProfileRecord[]): void {
  const byId = new Map(records.map((r) => [r.id, r]));
  mocks.loadProfileRecord.mockImplementation((id: string) => byId.get(id) ?? null);
  const profiles = records
    .map((r) => effectiveProfile(r))
    .filter((p): p is StyleProfile => p !== null);
  mocks.selectAllProfiles.mockReturnValue(profiles);
  mocks.loadState.mockReturnValue(makeState(profiles));
}

function lastByRole(
  role: Parameters<typeof screen.getAllByRole>[0],
  options?: Parameters<typeof screen.getAllByRole>[1],
): HTMLElement {
  const matches = screen.getAllByRole(role, options as never);
  return matches[matches.length - 1] as HTMLElement;
}

function inputByValue(container: HTMLElement, value: string): HTMLInputElement {
  return within(container).getAllByDisplayValue(value).pop() as HTMLInputElement;
}

describe("ProfileEditor", () => {
  const profile = makeProfile();

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    installRecords([makeRecord(profile)]);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  /**
   * The deterministic editor owns the deterministic rules and nothing else.
   *
   * It used to render measured style and semantic style as read-only lists,
   * which made this tab look like it owned a semantic profile and a metrics
   * view it can neither edit nor change. Both now live on the Semantic tab,
   * which shows all eight measured metrics and hosts the semantic editor.
   *
   * The assertion is about absence *and* about the pointer. Removing the
   * sections without leaving a route to them reads as data loss, which is the
   * failure this change most needed to avoid.
   */
  it("leaves measured and semantic style to the semantic tab, and says so", () => {
    const { container } = render(<ProfileEditor />);

    expect(inputByValue(container, "Saved profile")).toBeInTheDocument();
    expect(inputByValue(container, "utilize")).toBeInTheDocument();
    expect(within(container).queryByText("Measured style")).not.toBeInTheDocument();
    expect(within(container).queryByText("Semantic style")).not.toBeInTheDocument();
    // Still a sentence naming where they went, not a silent removal.
    expect(
      within(container).getByText(/Measured style and semantic style are on the Semantic tab/),
    ).toBeInTheDocument();
  });

  it("does not title itself over the page heading", () => {
    // The page owns the h1. A second one directly under it, naming the same
    // thing less precisely, gave the tab two competing headings.
    const { container } = render(<ProfileEditor />);
    expect(container.querySelector("h1")).toBeNull();
  });

  it("shows the assigned revision as a read-only field", () => {
    const { container } = render(<ProfileEditor />);
    const field = within(container).getByRole("textbox", { name: "Revision" });
    expect(field).toHaveValue("r1");
    expect(field).toBeDisabled();
    expect(
      within(container).getByText("Assigned automatically when a draft is saved."),
    ).toBeInTheDocument();
  });

  it("validates edits, previews the diff, and saves through updateDraft", async () => {
    const user = userEvent.setup();
    const { container } = render(<ProfileEditor />);
    /*
     * Named exactly, not by a prefix, and not by value.
     *
     * Two controls write `language.bannedTerms` — "Banned terms" in the
     * deterministic section and "Banned terms (one per line)" in the compact House
     * style view of the same record — and both hold "utilize". A prefix matcher and
     * a display-value matcher each resolved to whichever the DOM happened to list
     * last, so this test was asserting on one control while editing whichever came
     * after it. Exact name says which one it means.
     */
    const bannedInput = within(container).getByRole("textbox", { name: "Banned terms" });

    await user.clear(bannedInput);
    await user.type(bannedInput, "leverage");

    expect(lastByRole("button", { name: "Save profile" })).toBeEnabled();
    expect(screen.getByText("Unsaved profile changes")).toBeInTheDocument();
    // The banned-terms box is a multiline field, so the edit is asserted on its
    // value rather than on rendered text.
    expect(bannedInput).toHaveValue("leverage");

    await user.click(lastByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(mocks.saveProfileRecord).toHaveBeenCalledTimes(1);
    });
    const saved = mocks.saveProfileRecord.mock.calls[0]?.[0] as ProfileRecord;
    // ND-13: the form's banned-terms control writes the live `language` record
    // now, not the inert house-style one.
    expect(saved.draft?.language.bannedTerms).toEqual(["leverage"]);
    expect(saved.id).toBe(profile.id);
    // The record assigns the next revision; the editor never invents one.
    expect(saved.draft?.revision).toBe(2);
    expect(saved.revisions.map((r) => r.revision)).toEqual([1, 2]);
    expect(mocks.setActiveProfile).toHaveBeenCalledWith(profile.id);
    expect(await within(container).findByTestId("profile-editor-success")).toBeInTheDocument();
  });

  it("shows an accessible error and does not persist an invalid draft", async () => {
    const user = userEvent.setup();
    const { container } = render(<ProfileEditor />);
    const nameInput = inputByValue(container, "Saved profile");

    await user.clear(nameInput);
    await user.click(lastByRole("button", { name: "Save profile" }));

    expect(await within(container).findByTestId("profile-editor-error")).toHaveTextContent(
      "Resolve the profile validation errors before saving.",
    );
    expect(mocks.saveProfileRecord).not.toHaveBeenCalled();
  });

  it("resets dirty fields to the loaded profile", async () => {
    const user = userEvent.setup();
    const { container } = render(<ProfileEditor />);
    const bannedInput = inputByValue(container, "utilize");

    await user.clear(bannedInput);
    await user.type(bannedInput, "leverage");
    await user.click(lastByRole("button", { name: "Reset changes" }));

    expect(inputByValue(container, "utilize")).toBeInTheDocument();
    expect(lastByRole("button", { name: "Save profile" })).toBeDisabled();
    expect(screen.getByText("No unsaved profile changes.")).toBeInTheDocument();
  });

  it("creates a new unsaved profile without touching persistence", async () => {
    const user = userEvent.setup();
    render(<ProfileEditor />);

    await user.click(lastByRole("button", { name: "New profile" }));

    expect(inputByValue(document.body, "Untitled style profile")).toBeInTheDocument();
    expect(lastByRole("button", { name: "Save profile" })).toBeDisabled();
    expect(mocks.saveProfileRecord).not.toHaveBeenCalled();
  });

  it("creates a record on the first save of an unsaved profile", async () => {
    const user = userEvent.setup();
    const created = makeRecord(profile);
    mocks.createProfileRecord.mockReturnValue(created);
    render(<ProfileEditor />);

    await user.click(lastByRole("button", { name: "New profile" }));
    // A fresh profile has no banned terms, so the name is the field that
    // distinguishes it from the default the button already produced.
    const nameInput = inputByValue(document.body, "Untitled style profile");
    await user.clear(nameInput);
    await user.type(nameInput, "Second profile");
    await user.click(lastByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(mocks.createProfileRecord).toHaveBeenCalledTimes(1);
    });
    // `createProfileRecord` persists the record itself, so the editor must not
    // write it a second time.
    expect(mocks.saveProfileRecord).not.toHaveBeenCalled();
    expect(mocks.setActiveProfile).toHaveBeenCalledWith(created.id);
  });

  it("shows a terminology parse error instead of crashing", async () => {
    /*
     * Re-pointed rather than deleted, because the guarantee is still owed by the
     * product: a malformed line must be reported, not thrown. The textarea this
     * used to drive was the duplicate House style editor; the one remaining
     * textarea for this format is the bulk-add (ADR-0123), so that is where the
     * promise is kept now.
     *
     * `container.querySelector` opens the disclosure the way a user would — a
     * closed `<details>` hides its contents from the accessibility tree, so the
     * box cannot be reached any other way.
     */
    const user = userEvent.setup();
    const { container } = render(<ProfileEditor />);
    const details = container.querySelector<HTMLDetailsElement>("details.tf-bulk-add");
    expect(details).not.toBeNull();
    if (details === null) throw new Error("the bulk-add disclosure did not render");
    details.open = true;

    const terminologyInput = within(details).getByRole("textbox", {
      name: /Paste terms/,
    });
    await user.clear(terminologyInput);
    await user.type(terminologyInput, "no colon here");

    expect(within(container).queryByTestId("profile-editor-error")).not.toBeInTheDocument();
    expect(
      within(container).getByText('Terminology line 1 must use "term: replacement".'),
    ).toBeInTheDocument();
  });

  it("disables Save and Reset after a change is reverted", async () => {
    const user = userEvent.setup();
    const { container } = render(<ProfileEditor />);
    const bannedInput = inputByValue(container, "utilize");

    await user.clear(bannedInput);
    await user.type(bannedInput, "leverage");
    await user.clear(bannedInput);
    await user.type(bannedInput, "utilize");

    expect(lastByRole("button", { name: "Save profile" })).toBeDisabled();
    expect(lastByRole("button", { name: "Reset changes" })).toBeDisabled();
  });

  it("does not persist when nothing has changed", async () => {
    const user = userEvent.setup();
    render(<ProfileEditor />);

    await user.click(lastByRole("button", { name: "Save profile" }));

    expect(mocks.saveProfileRecord).not.toHaveBeenCalled();
    expect(mocks.setActiveProfile).not.toHaveBeenCalled();
  });

  it("switches the active profile when a saved profile is selected", async () => {
    const user = userEvent.setup();
    const other: StyleProfile = {
      ...createEmptyProfile("Other profile", 1),
      semantic: {
        ...SEMANTIC,
        tone: { ...SEMANTIC.tone, primary: "assertive" },
        formality: { score: 70, label: "" },
        register: { primary: "technical", description: "" },
        rhetoricalStyle: "forensic",
      },
      typography: sampleTypography({
        emDash: "hyphen",
        enDashSpacing: "tight",
        doubleQuotes: "straight",
        singleQuotes: "straight",
        apostrophes: "straight",
        decimalSeparator: "comma",
        thousandsSeparator: "space",
        ellipsis: "three-dots",
      }),
      houseStyle: {
        capitalization: { titleCaseWords: [] },
        spellingVariant: "en-GB",
      },
    };
    installRecords([makeRecord(profile), makeRecord(other)]);

    render(<ProfileEditor />);
    const savedDropdown = within(document.body).getByRole("combobox", {
      name: (name) => name.startsWith("Saved profiles"),
    });
    await user.click(savedDropdown);
    await user.click(within(document.body).getByRole("option", { name: /Other profile/ }));

    await waitFor(() => {
      expect(mocks.setActiveProfile).toHaveBeenCalledWith(other.id);
    });
    expect(inputByValue(document.body, "Other profile")).toBeInTheDocument();
  });

  it("restores an earlier revision as an unsaved draft without writing to persistence", async () => {
    const user = userEvent.setup();
    const previous: StyleProfile = { ...profile, name: "Earlier profile" };
    // r1 is the earlier snapshot; r2 is the current draft.
    installRecords([makeRecord(profile, [previous])]);

    render(<ProfileEditor />);
    await user.click(within(document.body).getByRole("button", { name: /Restore r1/ }));

    expect(mocks.saveProfileRecord).not.toHaveBeenCalled();
    expect(mocks.setActiveProfile).not.toHaveBeenCalled();
    expect(inputByValue(document.body, "Earlier profile")).toBeInTheDocument();
    expect(lastByRole("button", { name: "Save profile" })).toBeEnabled();
    expect(lastByRole("button", { name: "Reset changes" })).toBeEnabled();
  });

  it("shows a content-only diff after a restore and saves it as the next revision", async () => {
    const user = userEvent.setup();
    const previous: StyleProfile = {
      ...profile,
      name: "Earlier profile",
      typography: { ...profile.typography, doubleQuotes: "straight" },
    };
    // r1 is the earlier snapshot; r2 is the current draft.
    installRecords([makeRecord(profile, [previous])]);

    const { container } = render(<ProfileEditor />);
    await user.click(within(document.body).getByRole("button", { name: /Restore r1/ }));

    expect(inputByValue(container, "Earlier profile")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        within(container).getByText((content) =>
          content.includes("Profile changes from revision 2"),
        ),
      ).toBeInTheDocument();
    });

    await user.click(lastByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(mocks.saveProfileRecord).toHaveBeenCalledTimes(1);
    });
    const saved = mocks.saveProfileRecord.mock.calls[0]?.[0] as ProfileRecord;
    expect(saved.id).toBe(profile.id);
    // The restored content is saved as a new revision, never as a rewind.
    expect(saved.draft?.revision).toBe(3);
    expect(saved.draft?.name).toBe("Earlier profile");
    expect(mocks.setActiveProfile).toHaveBeenCalledWith(profile.id);
  });

  it("resets a restored snapshot to the latest revision data", async () => {
    const user = userEvent.setup();
    const previous: StyleProfile = {
      ...profile,
      name: "Earlier profile",
      typography: { ...profile.typography, doubleQuotes: "straight" },
    };
    installRecords([makeRecord(profile, [previous])]);

    const { container } = render(<ProfileEditor />);
    await user.click(within(document.body).getByRole("button", { name: /Restore r1/ }));
    await user.click(lastByRole("button", { name: "Reset changes" }));

    expect(inputByValue(container, "Saved profile")).toBeInTheDocument();
    expect(inputByValue(container, "utilize")).toBeInTheDocument();
    expect(within(container).getByRole("textbox", { name: "Revision" })).toHaveValue("r2");
    expect(lastByRole("button", { name: "Save profile" })).toBeDisabled();
    expect(lastByRole("button", { name: "Reset changes" })).toBeDisabled();
    expect(mocks.saveProfileRecord).not.toHaveBeenCalled();
    expect(mocks.setActiveProfile).not.toHaveBeenCalled();
  });

  it("no longer offers a second editor for the typography settings", () => {
    /*
     * Replaces a test that asserted a Fluent caret icon on the Typography
     * `Dropdown`s this component used to render. Those moved into
     * `DeterministicStyleSections`, which is now the single owner (D-1).
     *
     * The caret is the browser's on a native `<select>`, so there is nothing
     * left to assert about it here. What does matter — and what this now pins —
     * is that each setting is editable from exactly one place, which is the
     * two-owners defect the move was made to close.
     *
     * Note the count, not the presence: `ProfileEditor` *renders*
     * `DeterministicStyleSections`, so these labels are still in the tree. What
     * must not be true is a second copy sitting beside them — asserting absence
     * of the label would have tested the wrong thing and passed for the wrong
     * reason.
     */
    const { container } = render(<ProfileEditor />);
    ["Em dash", "Double quotes", "Thousands separator"].forEach((label) => {
      expect(screen.getAllByLabelText(label)).toHaveLength(1);
    });
    // And the panel that used to hold them is gone entirely.
    expect(container.querySelector('[aria-labelledby="typography-heading"]')).toBeNull();
  });

  /*
   * Removed rather than skipped.
   *
   * It asserted that a Fluent `Dropdown` renders a visible `ChevronDown` caret
   * that is `aria-hidden`, because the combobox announces its own value and the
   * caret must not be read out as a second node. That knowledge applies to every
   * Fluent dropdown in the add-in, so it is recorded here rather than lost with
   * the dropdowns.
   *
   * It could not stay as a test: this component renders no Fluent dropdowns now.
   * A `Dropdown`'s caret is an `<i class="ms-Dropdown-caretDown">` *inside* the
   * combobox element, not a sibling button, so there is no ancestor walk to find.
   * A test of it belongs beside a Fluent dropdown that still exists.
   */
});
