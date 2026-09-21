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
    localStorage.clear();
    vi.clearAllMocks();
    mocks.loadState.mockReturnValue(makeState(profile));
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
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
    expect(lastByRole("button", { name: "Save profile" })).toBeEnabled();
  });
});
