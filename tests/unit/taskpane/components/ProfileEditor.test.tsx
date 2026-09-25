import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createEmptyProfile, type StyleProfile } from "../../../../src/core/domain/StyleProfile";
import {
  createRecord,
  effectiveProfile,
  updateDraft,
  type ProfileRecord,
} from "../../../../src/core/domain/ProfileRecord";
import ProfileEditor from "../../../../src/taskpane/components/ProfileEditor";

const STAMP = "2024-01-01T00:00:00.000Z";

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
      tone: "neutral",
      voice: "third-person",
      formality: 50,
      readingGradeTarget: null,
      preferredSentenceLength: 22,
      vocabularyRegister: "standard",
      rhetoricalStyle: "direct",
      avoidWords: ["very"],
    },
    typography: {
      emDash: "em",
      emDashSpacing: "spaced",
      enDashSpacing: "spaced",
      doubleQuotes: "curly",
      singleQuotes: "curly",
      apostrophes: "curly",
      decimalSeparator: "dot",
      thousandsSeparator: "none",
      ellipsis: "ellipsis",
    },
    houseStyle: {
      preferredTerminology: { client: "customer" },
      bannedTerms: ["utilize"],
      capitalization: { sentenceCase: true, titleCaseWords: ["ToneForge"] },
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

  it("loads the active profile and renders measured metrics as read-only text", () => {
    const { container } = render(<ProfileEditor />);

    expect(inputByValue(container, "Saved profile")).toBeInTheDocument();
    expect(inputByValue(container, "neutral")).toBeInTheDocument();
    expect(within(container).getByText("Measured style")).toBeInTheDocument();
    expect(within(container).queryAllByText("Not available").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("textbox", { name: "Average sentence length" }),
    ).not.toBeInTheDocument();
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
    const toneInput = inputByValue(container, "neutral");

    await user.clear(toneInput);
    await user.type(toneInput, "conversational");

    expect(lastByRole("button", { name: "Save profile" })).toBeEnabled();
    expect(screen.getByText("Unsaved profile changes")).toBeInTheDocument();
    expect(screen.getByText("conversational")).toBeInTheDocument();

    await user.click(lastByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(mocks.saveProfileRecord).toHaveBeenCalledTimes(1);
    });
    const saved = mocks.saveProfileRecord.mock.calls[0]?.[0] as ProfileRecord;
    expect(saved.draft?.semantic.tone).toBe("conversational");
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
    const toneInput = inputByValue(container, "neutral");

    await user.clear(toneInput);
    await user.click(lastByRole("button", { name: "Save profile" }));

    expect(await within(container).findByTestId("profile-editor-error")).toHaveTextContent(
      "Resolve the profile validation errors before saving.",
    );
    expect(mocks.saveProfileRecord).not.toHaveBeenCalled();
  });

  it("resets dirty fields to the loaded profile", async () => {
    const user = userEvent.setup();
    const { container } = render(<ProfileEditor />);
    const toneInput = inputByValue(container, "neutral");

    await user.clear(toneInput);
    await user.type(toneInput, "conversational");
    await user.click(lastByRole("button", { name: "Reset changes" }));

    expect(inputByValue(container, "neutral")).toBeInTheDocument();
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
    const toneInput = inputByValue(document.body, "neutral");
    await user.clear(toneInput);
    await user.type(toneInput, "conversational");
    await user.click(lastByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(mocks.createProfileRecord).toHaveBeenCalledTimes(1);
    });
    expect(mocks.saveProfileRecord).toHaveBeenCalledWith(created);
    expect(mocks.setActiveProfile).toHaveBeenCalledWith(created.id);
  });

  it("shows a terminology parse error instead of crashing", async () => {
    const user = userEvent.setup();
    const { container } = render(<ProfileEditor />);
    const terminologyInput = within(container).getByRole("textbox", {
      name: (name) => name.startsWith("Preferred terminology"),
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
    const toneInput = inputByValue(container, "neutral");

    await user.clear(toneInput);
    await user.type(toneInput, "conversational");
    await user.clear(toneInput);
    await user.type(toneInput, "neutral");

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
        tone: "formal",
        voice: "second-person",
        formality: 70,
        readingGradeTarget: null,
        preferredSentenceLength: 24,
        vocabularyRegister: "technical",
        rhetoricalStyle: "analytical",
        avoidWords: [],
      },
      typography: {
        emDash: "hyphen",
        emDashSpacing: "tight",
        enDashSpacing: "tight",
        doubleQuotes: "straight",
        singleQuotes: "straight",
        apostrophes: "straight",
        decimalSeparator: "comma",
        thousandsSeparator: "space",
        ellipsis: "three-dots",
      },
      houseStyle: {
        preferredTerminology: { api: "interface" },
        bannedTerms: [],
        capitalization: { sentenceCase: false, titleCaseWords: [] },
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
    expect(inputByValue(document.body, "formal")).toBeInTheDocument();
  });

  it("restores an earlier revision as an unsaved draft without writing to persistence", async () => {
    const user = userEvent.setup();
    const previous: StyleProfile = {
      ...profile,
      semantic: { ...profile.semantic, tone: "formal" },
    };
    // r1 is the earlier snapshot; r2 is the current draft.
    installRecords([makeRecord(profile, [previous])]);

    render(<ProfileEditor />);
    await user.click(within(document.body).getByRole("button", { name: /Restore r1/ }));

    expect(mocks.saveProfileRecord).not.toHaveBeenCalled();
    expect(mocks.setActiveProfile).not.toHaveBeenCalled();
    expect(inputByValue(document.body, "formal")).toBeInTheDocument();
    expect(lastByRole("button", { name: "Save profile" })).toBeEnabled();
    expect(lastByRole("button", { name: "Reset changes" })).toBeEnabled();
  });

  it("shows a content-only diff after a restore and saves it as the next revision", async () => {
    const user = userEvent.setup();
    const previous: StyleProfile = {
      ...profile,
      semantic: { ...profile.semantic, tone: "formal", rhetoricalStyle: "narrative" },
    };
    // r1 is the earlier snapshot; r2 is the current draft.
    installRecords([makeRecord(profile, [previous])]);

    const { container } = render(<ProfileEditor />);
    await user.click(within(document.body).getByRole("button", { name: /Restore r1/ }));

    expect(inputByValue(container, "formal")).toBeInTheDocument();
    expect(inputByValue(container, "narrative")).toBeInTheDocument();
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
    expect(saved.draft?.semantic.tone).toBe("formal");
    expect(saved.draft?.semantic.rhetoricalStyle).toBe("narrative");
    expect(mocks.setActiveProfile).toHaveBeenCalledWith(profile.id);
  });

  it("resets a restored snapshot to the latest revision data", async () => {
    const user = userEvent.setup();
    const previous: StyleProfile = {
      ...profile,
      semantic: { ...profile.semantic, tone: "formal", rhetoricalStyle: "narrative" },
    };
    installRecords([makeRecord(profile, [previous])]);

    const { container } = render(<ProfileEditor />);
    await user.click(within(document.body).getByRole("button", { name: /Restore r1/ }));
    await user.click(lastByRole("button", { name: "Reset changes" }));

    expect(inputByValue(container, "neutral")).toBeInTheDocument();
    expect(inputByValue(container, "direct")).toBeInTheDocument();
    expect(within(container).getByRole("textbox", { name: "Revision" })).toHaveValue("r2");
    expect(lastByRole("button", { name: "Save profile" })).toBeDisabled();
    expect(lastByRole("button", { name: "Reset changes" })).toBeDisabled();
    expect(mocks.saveProfileRecord).not.toHaveBeenCalled();
    expect(mocks.setActiveProfile).not.toHaveBeenCalled();
  });

  it("renders a visible caret icon on the tone, voice, and rhetorical style combo boxes", () => {
    const { container } = render(<ProfileEditor />);
    const toneField = within(container).getByRole("combobox", {
      name: (name) => name.startsWith("Tone"),
    });
    const voiceField = within(container).getByRole("combobox", {
      name: (name) => name.startsWith("Voice"),
    });
    const rhetoricField = within(container).getByRole("combobox", {
      name: (name) => name.startsWith("Rhetorical style"),
    });

    for (const field of [toneField, voiceField, rhetoricField]) {
      const wrapper = field.parentElement;
      expect(wrapper).toBeTruthy();
      const caretButton = wrapper?.querySelector("button.ms-ComboBox-CaretDown-button");
      expect(caretButton).toBeTruthy();
      const icon = caretButton?.querySelector("i.ms-Icon");
      expect(icon).toBeTruthy();
      expect(icon?.getAttribute("data-icon-name")).toBe("ChevronDown");
    }
  });
});
