import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsForm from "../../../../src/taskpane/components/SettingsForm";

const mocks = vi.hoisted(() => ({
  saveState: vi.fn(),
  loadState: vi.fn(),
  clearPersistedCredentials: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock("../../../../src/core/state/index", () => ({
  loadState: () => mocks.loadState(),
  saveState: (state: unknown) => mocks.saveState(state),
  clearPersistedCredentials: () => mocks.clearPersistedCredentials(),
}));

vi.mock("../../../../src/shared/utils/logger", () => ({
  logger: { info: mocks.loggerInfo, warn: vi.fn(), error: vi.fn() },
}));

const baseState = {
  version: 4,
  profiles: [],
  profileHistory: {},
  activeProfileId: null,
  governanceProfiles: {},
  activeGovernanceProfileId: null,
  settings: {
    openAiBaseUrl: "https://localhost:3000/__toneforge/llm/v1",
    openAiModel: "gpt-4o-mini",
    llmProvider: "openai" as const,
    openAiCredentialMode: "broker" as const,
    spotReviewConsent: false,
    fullDocumentReviewConsent: false,
    semanticOptIn: false,
    telemetryDisabled: true,
  },
};

describe("SettingsForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.loadState.mockReturnValue(structuredClone(baseState));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads broker configuration without a credential field", () => {
    const { container } = render(<SettingsForm />);
    const llmSection = within(container).getByRole("region", { name: "Provider and privacy" });

    expect(within(llmSection).queryByLabelText(/API key/i)).not.toBeInTheDocument();
    expect(within(llmSection).getByText(/Credentials are never stored/i)).toBeInTheDocument();
    expect(within(llmSection).getByDisplayValue("gpt-4o-mini")).toBeInTheDocument();
    expect(
      within(llmSection).getByDisplayValue("https://localhost:3000/__toneforge/llm/v1"),
    ).toBeInTheDocument();
  });

  it("persists provider and consent settings without a key", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsForm />);
    const llmSection = within(container).getByRole("region", { name: "Provider and privacy" });
    const modelInput = within(llmSection).getByDisplayValue("gpt-4o-mini");
    await user.type(modelInput, "-changed");
    await user.click(within(llmSection).getByRole("button", { name: "Save provider and privacy" }));

    await waitFor(() => expect(mocks.saveState).toHaveBeenCalledOnce());
    const saved = JSON.stringify(mocks.saveState.mock.calls[0]?.[0]);
    expect(saved).toContain("gpt-4o-mini-changed");
    expect(saved).not.toContain("openAiApiKey");
  });

  it("logs provider metadata without credentials or prompts", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsForm />);
    const llmSection = within(container).getByRole("region", { name: "Provider and privacy" });
    await user.type(within(llmSection).getByDisplayValue("gpt-4o-mini"), "-changed");
    await user.click(within(llmSection).getByRole("button", { name: "Save provider and privacy" }));

    await waitFor(() => expect(mocks.loggerInfo).toHaveBeenCalled());
    const logged = JSON.stringify(mocks.loggerInfo.mock.calls[0]);
    expect(logged).toContain('"credentialMode":"broker"');
    expect(logged).not.toMatch(/key|prompt|document text/i);
  });

  it("clears a legacy stored credential and selects mock", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsForm />);
    mocks.clearPersistedCredentials.mockImplementation(() => {
      mocks.loadState.mockReturnValue({
        ...structuredClone(baseState),
        settings: { ...structuredClone(baseState.settings), llmProvider: "mock" },
      });
      return mocks.loadState();
    });
    const llmSection = within(container).getByRole("region", { name: "Provider and privacy" });

    await user.click(
      within(llmSection).getByRole("button", { name: "Clear legacy stored credential" }),
    );

    expect(mocks.clearPersistedCredentials).toHaveBeenCalledOnce();
    expect(
      within(llmSection)
        .getAllByRole("status")
        .some((node) => node.textContent?.includes("Provider and privacy settings saved")),
    ).toBe(true);
  });

  it("removes optional broker configuration when cleared", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsForm />);
    const llmSection = within(container).getByRole("region", { name: "Provider and privacy" });
    const baseUrlInput = within(llmSection).getByDisplayValue(
      "https://localhost:3000/__toneforge/llm/v1",
    );
    const modelInput = within(llmSection).getByDisplayValue("gpt-4o-mini");

    await user.clear(baseUrlInput);
    await user.clear(modelInput);
    await user.click(within(llmSection).getByRole("button", { name: "Save provider and privacy" }));

    await waitFor(() => expect(mocks.saveState).toHaveBeenCalledOnce());
    const settings = mocks.saveState.mock.calls[0]?.[0].settings;
    expect(settings).not.toHaveProperty("openAiBaseUrl");
    expect(settings).not.toHaveProperty("openAiModel");
  });

  it("rejects an invalid broker URL", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsForm />);
    const llmSection = within(container).getByRole("region", { name: "Provider and privacy" });
    const baseUrlInput = within(llmSection).getByDisplayValue(
      "https://localhost:3000/__toneforge/llm/v1",
    );
    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, "not-a-url");
    await user.click(within(llmSection).getByRole("button", { name: "Save provider and privacy" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Broker base URL is not a valid URL.",
    );
    expect(mocks.saveState).not.toHaveBeenCalled();
  });

  it("persists telemetry independently", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsForm />);
    const telemetrySection = within(container).getByRole("region", { name: "Telemetry" });
    await user.click(within(telemetrySection).getByRole("switch", { name: "Disable telemetry" }));
    await user.click(within(telemetrySection).getByRole("button", { name: "Save telemetry" }));

    await waitFor(() => expect(mocks.saveState).toHaveBeenCalledOnce());
    const saved = mocks.saveState.mock.calls[0]?.[0] as {
      settings: { telemetryDisabled: boolean };
    };
    expect(saved.settings.telemetryDisabled).toBe(false);
  });
});
