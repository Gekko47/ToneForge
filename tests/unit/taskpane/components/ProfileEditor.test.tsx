import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createEmptyProfile, type StyleProfile } from "../../../../src/core/domain/StyleProfile";
import ProfileEditor from "../../../../src/taskpane/components/ProfileEditor";

const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  upsertProfile: vi.fn(),
  setActiveProfile: vi.fn(),
}));

vi.mock("../../../../src/core/state/index", () => ({
  loadState: () => mocks.loadState(),
  upsertProfile: (profile: unknown) => mocks.upsertProfile(profile),
  setActiveProfile: (id: unknown) => mocks.setActiveProfile(id),
}));

function makeProfile(): StyleProfile {
  return {
    ...createEmptyProfile("Saved profile"),
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

function makeState(profile: StyleProfile = makeProfile()) {
  return {
    version: 2,
    profiles: [profile],
    profileHistory: { [profile.id]: [profile] },
    activeProfileId: profile.id,
    settings: { telemetryDisabled: true },
  };
}

function withVersion(profile: StyleProfile, patch: number): StyleProfile {
  return {
    ...profile,
    version: { major: 1, minor: 0, patch },
    updatedAt: `2024-01-0${patch + 1}T00:00:00.000Z`,
  };
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
    mocks.loadState.mockReturnValue(makeState(profile));
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

  it("validates edits, previews the diff, and persists the saved profile", async () => {
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
      expect(mocks.upsertProfile).toHaveBeenCalledTimes(1);
    });
    const saved = mocks.upsertProfile.mock.calls[0]?.[0] as StyleProfile;
    expect(saved.semantic.tone).toBe("conversational");
    expect(saved.id).toBe(profile.id);
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
    expect(mocks.upsertProfile).not.toHaveBeenCalled();
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
    expect(mocks.upsertProfile).not.toHaveBeenCalled();
  });

  it("bumps the version and marks the profile dirty", async () => {
    const user = userEvent.setup();
    render(<ProfileEditor />);

    await user.click(lastByRole("button", { name: "Major" }));

    expect(within(document.body).getByRole("textbox", { name: "Version" })).toHaveValue("v2.0.0");
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

  it("auto-bumps the patch version when content changes and the version is unchanged", async () => {
    const user = userEvent.setup();
    const { container } = render(<ProfileEditor />);
    const toneInput = inputByValue(container, "neutral");

    await user.clear(toneInput);
    await user.type(toneInput, "conversational");
    await user.click(lastByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(mocks.upsertProfile).toHaveBeenCalledTimes(1);
    });
    const saved = mocks.upsertProfile.mock.calls[0]?.[0] as StyleProfile;
    expect(saved.semantic.tone).toBe("conversational");
    expect(saved.version.major).toBe(profile.version.major);
    expect(saved.version.minor).toBe(profile.version.minor);
    expect(saved.version.patch).toBe(profile.version.patch + 1);
  });

  it("does not persist when nothing has changed", async () => {
    const user = userEvent.setup();
    render(<ProfileEditor />);

    await user.click(lastByRole("button", { name: "Save profile" }));

    expect(mocks.upsertProfile).not.toHaveBeenCalled();
    expect(mocks.setActiveProfile).not.toHaveBeenCalled();
  });

  it("switches the active profile when a saved profile is selected", async () => {
    const user = userEvent.setup();
    const other = {
      ...createEmptyProfile("Other profile"),
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
    mocks.loadState.mockReturnValue({
      version: 2,
      profiles: [profile, other],
      profileHistory: {
        [profile.id]: [profile],
        [other.id]: [other],
      },
      activeProfileId: profile.id,
      settings: { telemetryDisabled: true },
    });

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

  it("restores a history snapshot as an unsaved draft without writing to persistence", async () => {
    const user = userEvent.setup();
    const previous = {
      ...profile,
      semantic: { ...profile.semantic, tone: "formal" },
      version: { major: 1, minor: 2, patch: 3 },
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    mocks.loadState.mockReturnValue({
      version: 2,
      profiles: [profile],
      profileHistory: { [profile.id]: [previous, profile] },
      activeProfileId: profile.id,
      settings: { telemetryDisabled: true },
    });

    render(<ProfileEditor />);
    await user.click(within(document.body).getByRole("button", { name: /Restore v1.2.3/ }));

    expect(mocks.upsertProfile).not.toHaveBeenCalled();
    expect(mocks.setActiveProfile).not.toHaveBeenCalled();
    expect(inputByValue(document.body, "formal")).toBeInTheDocument();
    expect(lastByRole("button", { name: "Save profile" })).toBeEnabled();
    expect(lastByRole("button", { name: "Reset changes" })).toBeEnabled();
  });

  it("saves a restored earlier revision as the next patch of the latest revision", async () => {
    const user = userEvent.setup();
    const latest = withVersion(makeProfile(), 2);
    const previous = {
      ...latest,
      semantic: {
        ...latest.semantic,
        tone: "formal",
        rhetoricalStyle: "narrative",
      },
      version: { major: 1, minor: 0, patch: 1 },
      updatedAt: "2024-01-02T00:00:00.000Z",
    };
    mocks.loadState.mockReturnValue({
      version: 2,
      profiles: [latest],
      profileHistory: { [latest.id]: [previous, latest] },
      activeProfileId: latest.id,
      settings: { telemetryDisabled: true },
    });

    const { container } = render(<ProfileEditor />);
    await user.click(within(document.body).getByRole("button", { name: /Restore v1.0.1/ }));

    expect(inputByValue(container, "formal")).toBeInTheDocument();
    expect(inputByValue(container, "narrative")).toBeInTheDocument();
    expect(
      screen.queryByText("Resolve validation errors to preview profile changes."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Save this profile to establish a baseline for change previews."),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        within(container).getByText((content) =>
          content.includes("Profile changes from v1.0.2 to v1.0.2"),
        ),
      ).toBeInTheDocument();
      expect(
        within(container).queryByText((content) =>
          content.includes("Profile changes from v1.0.2 to v1.0.1"),
        ),
      ).not.toBeInTheDocument();
    });

    await user.click(lastByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(mocks.upsertProfile).toHaveBeenCalledTimes(1);
    });
    const saved = mocks.upsertProfile.mock.calls[0]?.[0] as StyleProfile;
    expect(saved.id).toBe(latest.id);
    expect(saved.version).toEqual({ major: 1, minor: 0, patch: 3 });
    expect(saved.semantic.tone).toBe("formal");
    expect(saved.semantic.rhetoricalStyle).toBe("narrative");
    expect(mocks.setActiveProfile).toHaveBeenCalledWith(latest.id);
  });

  it("resets a restored snapshot to the latest revision data", async () => {
    const user = userEvent.setup();
    const latest = withVersion(makeProfile(), 2);
    const previous = {
      ...latest,
      semantic: {
        ...latest.semantic,
        tone: "formal",
        rhetoricalStyle: "narrative",
      },
      version: { major: 1, minor: 0, patch: 1 },
      updatedAt: "2024-01-02T00:00:00.000Z",
    };
    mocks.loadState.mockReturnValue({
      version: 2,
      profiles: [latest],
      profileHistory: { [latest.id]: [previous, latest] },
      activeProfileId: latest.id,
      settings: { telemetryDisabled: true },
    });

    const { container } = render(<ProfileEditor />);
    await user.click(within(document.body).getByRole("button", { name: /Restore v1.0.1/ }));
    await user.click(lastByRole("button", { name: "Reset changes" }));

    expect(inputByValue(container, "neutral")).toBeInTheDocument();
    expect(inputByValue(container, "direct")).toBeInTheDocument();
    expect(within(container).getByRole("textbox", { name: "Version" })).toHaveValue("v1.0.2");
    expect(lastByRole("button", { name: "Save profile" })).toBeDisabled();
    expect(lastByRole("button", { name: "Reset changes" })).toBeDisabled();
    expect(mocks.upsertProfile).not.toHaveBeenCalled();
    expect(mocks.setActiveProfile).not.toHaveBeenCalled();
  });

  it("does not auto-bump again after an explicit patch following restore", async () => {
    const user = userEvent.setup();
    const latest = withVersion(makeProfile(), 2);
    const previous = {
      ...latest,
      semantic: { ...latest.semantic, tone: "formal" },
      version: { major: 1, minor: 0, patch: 1 },
      updatedAt: "2024-01-02T00:00:00.000Z",
    };
    mocks.loadState.mockReturnValue({
      version: 2,
      profiles: [latest],
      profileHistory: { [latest.id]: [previous, latest] },
      activeProfileId: latest.id,
      settings: { telemetryDisabled: true },
    });

    render(<ProfileEditor />);
    await user.click(within(document.body).getByRole("button", { name: /Restore v1.0.1/ }));
    await user.click(lastByRole("button", { name: "Patch" }));
    expect(within(document.body).getByRole("textbox", { name: "Version" })).toHaveValue("v1.0.3");
    await user.click(lastByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(mocks.upsertProfile).toHaveBeenCalledTimes(1);
    });
    const saved = mocks.upsertProfile.mock.calls[0]?.[0] as StyleProfile;
    expect(saved.version).toEqual({ major: 1, minor: 0, patch: 3 });
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
