import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import OpenRouterConnectionSettings from "../../../../src/taskpane/components/OpenRouterConnectionSettings";
import { GatewayError } from "../../../../src/ai/gateway";
import {
  ModelCatalogSchema,
  ProviderConnectionSchema,
  type ModelCatalog,
  type ProviderConnection,
} from "../../../../src/core/domain/index";

/**
 * The credential contract this file exists to enforce, in the order it matters:
 *
 * 1. the key is typed, sent once, and gone — never in state, never in a log;
 * 2. only the opaque connection reference is persisted;
 * 3. a refused key leaves nothing behind to retry with;
 * 4. a failed disconnect still clears the local record.
 */

const mocks = vi.hoisted(() => ({
  submitBrokerApiKey: vi.fn(),
  fetchModelCatalog: vi.fn(),
  disconnect: vi.fn(),
  loadState: vi.fn(),
  saveState: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock("../../../../src/ai/gateway", () => ({
  createProviderGatewayClient: () => ({
    submitBrokerApiKey: mocks.submitBrokerApiKey,
    fetchModelCatalog: mocks.fetchModelCatalog,
    disconnect: mocks.disconnect,
  }),
  SessionTokenStore: class {
    set(): void {}
    clear(): void {}
  },
  GatewayError: class extends Error {},
}));

vi.mock("../../../../src/core/state/index", () => ({
  loadState: () => mocks.loadState(),
  saveState: (state: unknown) => mocks.saveState(state),
  clearPersistedCredentials: vi.fn(),
}));

vi.mock("../../../../src/shared/utils/logger", () => ({
  logger: { info: mocks.loggerInfo, warn: mocks.loggerWarn, error: vi.fn() },
}));

const GATEWAY_ORIGIN = "http://localhost:3000/__toneforge/gateway";
const API_KEY = "sk-or-v1-0123456789abcdefghij";

// Built through the real schemas rather than hand-written literals: the tests
// then exercise the same validation the component sees at runtime, and the
// fixtures cannot drift from the contract.
function connection(overrides: Record<string, unknown> = {}): ProviderConnection {
  return ProviderConnectionSchema.parse({
    connectionId: "or_0123456789abcdef0123456789abcdef",
    provider: "openrouter",
    authMode: "brokerApiKey",
    status: "connected",
    baseOrigin: { origin: GATEWAY_ORIGIN, classification: "loopbackDevelopment" },
    ...overrides,
  });
}

function catalog(overrides: Record<string, unknown> = {}): ModelCatalog {
  return ModelCatalogSchema.parse({
    provider: "openrouter",
    connectionId: "or_0123456789abcdef0123456789abcdef",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    models: [
      {
        id: "openai/gpt-4o-mini",
        displayName: "GPT-4o mini",
        description: "",
        contextWindow: 128_000,
        inputModalities: ["text"],
        outputModalities: ["text"],
        supportsStructuredOutput: true,
        supportsTools: true,
        supportsReasoning: false,
        deprecated: false,
      },
    ],
    ...overrides,
  });
}

function renderSection(props: Partial<ComponentProps<typeof OpenRouterConnectionSettings>> = {}) {
  return render(
    <OpenRouterConnectionSettings
      gatewayOrigin={GATEWAY_ORIGIN}
      connection={undefined}
      catalog={null}
      models={[]}
      onCatalogChange={vi.fn()}
      selectedModel=""
      onSelectModel={vi.fn()}
      {...props}
    />,
  );
}

describe("OpenRouterConnectionSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadState.mockReturnValue({ version: 8, providerConnections: {}, settings: {} });
    mocks.submitBrokerApiKey.mockResolvedValue(connection());
    mocks.fetchModelCatalog.mockResolvedValue(catalog());
    mocks.disconnect.mockResolvedValue(undefined);
  });

  it("prefills the real OpenRouter base URL", () => {
    renderSection();
    expect(screen.getByDisplayValue("https://openrouter.ai/api/v1")).toBeInTheDocument();
  });

  it("offers a masked key field with autocomplete disabled", () => {
    renderSection();
    const field = screen.getByLabelText(/OpenRouter API key/i);
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "off");
  });

  it("sends the key and the configured base URL to the gateway once", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByLabelText(/OpenRouter API key/i), API_KEY);
    await user.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));

    await waitFor(() => expect(mocks.submitBrokerApiKey).toHaveBeenCalledOnce());
    expect(mocks.submitBrokerApiKey).toHaveBeenCalledWith(
      "openrouter",
      API_KEY,
      "https://openrouter.ai/api/v1",
    );
  });

  it("clears the key field as soon as the request is issued", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByLabelText(/OpenRouter API key/i), API_KEY);
    await user.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));

    // The field must be empty while the request is still in flight, not after
    // it resolves: a key left on screen during a retry is a key on screen.
    await waitFor(() => expect(screen.getByLabelText(/OpenRouter API key/i)).toHaveValue(""));
  });

  it("clears the key even when the gateway refuses it", async () => {
    const user = userEvent.setup();
    mocks.submitBrokerApiKey.mockRejectedValue(new Error("Gateway rejected the session"));
    renderSection();
    await user.type(screen.getByLabelText(/OpenRouter API key/i), API_KEY);
    await user.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));

    await waitFor(() => expect(screen.getByLabelText(/OpenRouter API key/i)).toHaveValue(""));
  });

  it("never writes the key into persisted state", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByLabelText(/OpenRouter API key/i), API_KEY);
    await user.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));

    await waitFor(() => expect(mocks.saveState).toHaveBeenCalled());
    expect(JSON.stringify(mocks.saveState.mock.calls)).not.toContain(API_KEY);
  });

  it("never writes the key into a log line", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByLabelText(/OpenRouter API key/i), API_KEY);
    await user.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));

    await waitFor(() => expect(mocks.loggerInfo).toHaveBeenCalled());
    expect(JSON.stringify(mocks.loggerInfo.mock.calls)).not.toContain(API_KEY);
  });

  it("persists only the opaque connection reference", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByLabelText(/OpenRouter API key/i), API_KEY);
    await user.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));

    await waitFor(() => expect(mocks.saveState).toHaveBeenCalled());
    const saved = mocks.saveState.mock.calls[0]?.[0] as {
      providerConnections: Record<string, ProviderConnection>;
    };
    expect(saved.providerConnections.openrouter?.connectionId).toBe(
      "or_0123456789abcdef0123456789abcdef",
    );
  });

  it("reports a refused key without pretending to be connected", async () => {
    const user = userEvent.setup();
    mocks.submitBrokerApiKey.mockRejectedValue(
      new GatewayError("Gateway rejected the session", "unauthorized", false, 401),
    );
    renderSection();
    await user.type(screen.getByLabelText(/OpenRouter API key/i), API_KEY);
    await user.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));

    await waitFor(() => expect(screen.getByText(/Gateway rejected the session/i)).toBeVisible());
    expect(mocks.saveState).not.toHaveBeenCalled();
  });

  it("explains a transport failure without echoing raw error text", async () => {
    const user = userEvent.setup();
    mocks.submitBrokerApiKey.mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:3000/__toneforge/gateway"),
    );
    renderSection();
    await user.type(screen.getByLabelText(/OpenRouter API key/i), API_KEY);
    await user.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));

    await waitFor(() => expect(screen.getByText(/local broker is running/i)).toBeVisible());
    // An internal address is not something the user can act on, so it is not
    // put on screen.
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
  });

  it("refuses to submit a key that fails validation", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByLabelText(/OpenRouter API key/i), "short");
    await user.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));

    await waitFor(() => expect(screen.getByText(/complete API key/i)).toBeVisible());
    expect(mocks.submitBrokerApiKey).not.toHaveBeenCalled();
  });

  it("refuses to submit against a non-HTTPS base URL", async () => {
    const user = userEvent.setup();
    renderSection();
    const baseUrl = screen.getByDisplayValue("https://openrouter.ai/api/v1");
    await user.clear(baseUrl);
    await user.type(baseUrl, "http://openrouter.ai/api/v1");
    await user.type(screen.getByLabelText(/OpenRouter API key/i), API_KEY);
    await user.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));

    await waitFor(() => expect(screen.getByText(/must use HTTPS/i)).toBeVisible());
    expect(mocks.submitBrokerApiKey).not.toHaveBeenCalled();
  });

  it("fetches the model list right after the connection is issued", async () => {
    const user = userEvent.setup();
    const onCatalogChange = vi.fn();
    renderSection({ onCatalogChange });
    await user.type(screen.getByLabelText(/OpenRouter API key/i), API_KEY);
    await user.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));

    await waitFor(() => expect(onCatalogChange).toHaveBeenCalledWith(catalog()));
  });

  it("discards a catalog that belongs to a different connection", async () => {
    // A model list fetched for another credential would offer models this
    // connection cannot use, so it is refused rather than displayed.
    const user = userEvent.setup();
    const onCatalogChange = vi.fn();
    mocks.fetchModelCatalog.mockResolvedValue(catalog({ connectionId: "or_someone_else" }));
    renderSection({ onCatalogChange });
    await user.type(screen.getByLabelText(/OpenRouter API key/i), API_KEY);
    await user.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));

    await waitFor(() => expect(onCatalogChange).toHaveBeenCalledWith(null));
  });

  it("offers Disconnect and a key field only when disconnected", async () => {
    const user = userEvent.setup();
    const { rerender } = renderSection();
    await user.type(screen.getByLabelText(/OpenRouter API key/i), API_KEY);
    await user.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));
    await waitFor(() => expect(mocks.fetchModelCatalog).toHaveBeenCalled());

    rerender(
      <OpenRouterConnectionSettings
        gatewayOrigin={GATEWAY_ORIGIN}
        connection={connection()}
        catalog={catalog()}
        models={[]}
        onCatalogChange={vi.fn()}
        selectedModel=""
        onSelectModel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Disconnect OpenRouter/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/OpenRouter API key/i)).not.toBeInTheDocument();
  });

  it("warns that disconnecting cannot be undone without the key", () => {
    renderSection({ connection: connection() });
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it("clears the persisted connection on disconnect", async () => {
    const user = userEvent.setup();
    renderSection({ connection: connection() });
    await user.click(screen.getByRole("button", { name: /Disconnect OpenRouter/i }));

    await waitFor(() => expect(mocks.saveState).toHaveBeenCalled());
    const saved = mocks.saveState.mock.calls[0]?.[0] as {
      providerConnections: Record<string, unknown>;
    };
    expect(saved.providerConnections.openrouter).toBeUndefined();
  });

  it("clears the local record even when the gateway call fails", async () => {
    // Leaving a `connected` record after the user pressed Disconnect would leave
    // the pane claiming a working credential the gateway has already dropped.
    const user = userEvent.setup();
    const onCatalogChange = vi.fn();
    mocks.disconnect.mockRejectedValue(new Error("network down"));
    renderSection({ connection: connection(), onCatalogChange });
    await user.click(screen.getByRole("button", { name: /Disconnect OpenRouter/i }));

    await waitFor(() => expect(mocks.saveState).toHaveBeenCalled());
    expect(onCatalogChange).toHaveBeenCalledWith(null);
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it("shows a Connect button only when there is no connection", () => {
    renderSection({ connection: connection() });
    // Anchored so this does not match "Disconnect OpenRouter".
    expect(screen.queryByRole("button", { name: /^connect openrouter$/i })).not.toBeInTheDocument();
  });
});
