import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsForm from "../../../../src/taskpane/components/SettingsForm";

// vi.mock factories are hoisted above the rest of the file, so any referenced
// variable must be created with vi.hoisted to avoid "Cannot access before
// initialization" errors.
const mocks = vi.hoisted(() => ({
  saveState: vi.fn(),
  loadState: vi.fn(),
  redact: vi.fn((v: string) => `***${v.slice(-2)}`),
  loggerInfo: vi.fn(),
}));

vi.mock("../../../../src/core/state/index", () => ({
  loadState: () => mocks.loadState(),
  saveState: (s: unknown) => mocks.saveState(s),
}));

vi.mock("../../../../src/core/config/env", () => ({
  redact: mocks.redact,
}));

vi.mock("../../../../src/shared/utils/logger", () => ({
  logger: { info: mocks.loggerInfo, warn: vi.fn(), error: vi.fn() },
}));

const baseState = {
  version: 1,
  profiles: [],
  activeProfileId: null,
  settings: {
    openAiApiKey: "sk-live-secret-key-1234",
    openAiBaseUrl: "https://api.openai.com/v1",
    openAiModel: "gpt-4o-mini",
    telemetryDisabled: true,
  },
};

/** Fluent renders duplicate controls under React StrictMode in jsdom; pick the last. */
function lastByRole(role: Parameters<typeof screen.getAllByRole>[0], options: unknown) {
  const all = screen.getAllByRole(role, options as never);
  return all[all.length - 1] as HTMLElement;
}

describe("SettingsForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadState.mockReturnValue({ ...baseState });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads persisted settings on mount", () => {
    const { container } = render(<SettingsForm />);
    const keyInput = within(container)
      .getAllByDisplayValue("sk-live-secret-key-1234")
      .pop() as HTMLInputElement;
    expect(keyInput).toBeInTheDocument();
    expect(keyInput.type).toBe("password");
    expect(
      (
        within(container)
          .getAllByDisplayValue("https://api.openai.com/v1")
          .pop() as HTMLInputElement
      ).value,
    ).toBe("https://api.openai.com/v1");
    expect(
      (within(container).getAllByDisplayValue("gpt-4o-mini").pop() as HTMLInputElement).value,
    ).toBe("gpt-4o-mini");
  });

  it("shows redacted key as placeholder when key is present", () => {
    const { container } = render(<SettingsForm />);
    const keyInput = within(container)
      .getAllByDisplayValue("sk-live-secret-key-1234")
      .pop() as HTMLInputElement;
    expect(keyInput.placeholder).toBe("***34");
    expect(mocks.redact).toHaveBeenCalledWith("sk-live-secret-key-1234");
  });

  it("marks dirty and enables save when a field changes", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsForm />);
    const saveBtn = lastByRole("button", { name: "Save" });
    expect(saveBtn).toBeDisabled();

    const modelInput = within(container)
      .getAllByDisplayValue("gpt-4o-mini")
      .pop() as HTMLInputElement;
    await user.type(modelInput, "-changed");
    expect(saveBtn).toBeEnabled();
  });

  it("persists settings on save", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsForm />);
    const modelInput = within(container)
      .getAllByDisplayValue("gpt-4o-mini")
      .pop() as HTMLInputElement;
    await user.type(modelInput, "-changed");
    await user.click(lastByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.saveState).toHaveBeenCalledTimes(1);
    });
    const saved = mocks.saveState.mock.calls[0]?.[0] as {
      settings: { openAiModel: string; openAiApiKey: string };
    };
    expect(saved.settings.openAiModel).toBe("gpt-4o-mini-changed");
    expect(saved.settings.openAiApiKey).toBe("sk-live-secret-key-1234");
  });

  it("logs only the redacted key, never the raw value", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsForm />);
    const modelInput = within(container)
      .getAllByDisplayValue("gpt-4o-mini")
      .pop() as HTMLInputElement;
    await user.type(modelInput, "-changed");
    await user.click(lastByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.loggerInfo).toHaveBeenCalled();
    });
    const logged = JSON.stringify(mocks.loggerInfo.mock.calls[0]);
    expect(logged).toContain("***34");
    expect(logged).not.toContain("sk-live-secret-key-1234");
  });

  it("shows error and does not save on invalid base URL", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsForm />);
    const baseUrlInput = within(container)
      .getAllByDisplayValue("https://api.openai.com/v1")
      .pop() as HTMLInputElement;
    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, "not-a-url");
    await user.click(lastByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Base URL is not a valid URL.");
    expect(mocks.saveState).not.toHaveBeenCalled();
  });

  it("toggles telemetry and semantic opt-in", async () => {
    const user = userEvent.setup();
    render(<SettingsForm />);

    const telemetry = screen
      .getAllByRole("switch", { name: /Disable telemetry/i })
      .pop() as HTMLElement;
    expect(telemetry).toBeChecked();
    await user.click(telemetry);
    expect(telemetry).not.toBeChecked();

    const semantic = screen
      .getAllByRole("switch", { name: /Allow semantic analysis/i })
      .pop() as HTMLElement;
    expect(semantic).not.toBeChecked();
    await user.click(semantic);
    expect(semantic).toBeChecked();
  });

  it("cancel restores original values and clears dirty state", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsForm />);
    const modelInput = within(container)
      .getAllByDisplayValue("gpt-4o-mini")
      .pop() as HTMLInputElement;
    await user.type(modelInput, "-changed");
    expect(lastByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(lastByRole("button", { name: "Cancel" }));
    expect(lastByRole("button", { name: "Save" })).toBeDisabled();
    expect(
      (within(container).getAllByDisplayValue("gpt-4o-mini").pop() as HTMLInputElement).value,
    ).toBe("gpt-4o-mini");
  });
});
