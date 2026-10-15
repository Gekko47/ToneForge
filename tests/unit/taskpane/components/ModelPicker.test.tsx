import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { useState } from "react";
import ModelPicker from "../../../../src/taskpane/components/ModelPicker";
import { GatewayError } from "../../../../src/ai/gateway";
import {
  ModelCatalogSchema,
  ProviderConnectionSchema,
  type ModelCatalog,
  type ProviderConnection,
} from "../../../../src/core/domain/index";

/**
 * The picker's contract for a connection the gateway no longer knows.
 *
 * The gateway holds its connections for the life of its process, so a dev-server
 * restart leaves a persisted connection reference it cannot resolve. Every
 * connection-scoped route then answers 404. The picker must say "reconnect"
 * rather than offering a retry that can never succeed, and it must still allow
 * manual entry so a user who knows the model id is not blocked.
 */

const mocks = vi.hoisted(() => ({
  fetchModelCatalog: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock("../../../../src/ai/gateway", () => ({
  createProviderGatewayClient: () => ({
    fetchModelCatalog: mocks.fetchModelCatalog,
  }),
  SessionTokenStore: class {
    set(): void {}
    clear(): void {}
  },
  GatewayError: class extends Error {
    constructor(
      message: string,
      public readonly kind: string,
      public readonly retryable = false,
    ) {
      super(message);
    }
  },
}));

vi.mock("../../../../src/shared/utils/logger", () => ({
  logger: { info: vi.fn(), warn: mocks.loggerWarn, error: vi.fn() },
}));

function connection(): ProviderConnection {
  return ProviderConnectionSchema.parse({
    connectionId: "or_ea6a1b5ace07a542b77ba2fcc85735ff",
    provider: "openrouter",
    authMode: "brokerApiKey",
    status: "connected",
  });
}

function catalog(): ModelCatalog {
  return ModelCatalogSchema.parse({
    provider: "openrouter",
    connectionId: "or_ea6a1b5ace07a542b77ba2fcc85735ff",
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
      {
        id: "anthropic/claude-3-haiku-20240307",
        displayName: "Claude 3 Haiku",
        description: "",
        contextWindow: 200_000,
        inputModalities: ["text"],
        outputModalities: ["text"],
        supportsStructuredOutput: true,
        supportsTools: true,
        supportsReasoning: false,
        deprecated: false,
      },
      {
        id: "google/gemini-1.5-flash",
        displayName: "Gemini 1.5 Flash",
        description: "",
        contextWindow: 1_000_000,
        inputModalities: ["text"],
        outputModalities: ["text"],
        supportsStructuredOutput: true,
        supportsTools: true,
        supportsReasoning: false,
        deprecated: false,
      },
    ],
  });
}

function renderPicker(props: Partial<ComponentProps<typeof ModelPicker>> = {}) {
  function Wrapper() {
    const [value, setValue] = useState("");
    return (
      <ModelPicker
        {...props}
        provider="openrouter"
        value={value}
        onChange={(model) => {
          setValue(model);
          props.onChange?.(model);
        }}
        connection={connection()}
        gatewayOrigin={props.gatewayOrigin ?? "/"}
      />
    );
  }
  return render(<Wrapper />);
}

describe("ModelPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers the fetched catalog as a list", async () => {
    mocks.fetchModelCatalog.mockResolvedValue(catalog());
    renderPicker();

    await waitFor(() => expect(screen.getByTestId("model-picker-list")).toBeInTheDocument());
    expect(screen.getByText(/3 model\(s\) available/)).toBeInTheDocument();
  });

  it("filters the list by substring as the user types", async () => {
    mocks.fetchModelCatalog.mockResolvedValue(catalog());
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderPicker();

    await waitFor(() => expect(screen.getByTestId("model-picker-list")).toBeInTheDocument());
    const input = screen.getByRole("combobox") as HTMLInputElement;

    await user.type(input, "haiku");
    // The note describes the connection, not the current search, so it keeps
    // reporting the full catalog while the visible options narrow.
    await waitFor(() => expect(screen.getByText(/Claude 3 Haiku/i)).toBeInTheDocument());
    expect(screen.getByText(/3 model\(s\) available/)).toBeInTheDocument();
    expect(screen.queryByText(/Gemini 1\.5 Flash/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/GPT-4o mini/i)).not.toBeInTheDocument();

    await user.clear(input);
    await waitFor(() => expect(screen.getByText(/Gemini 1\.5 Flash/i)).toBeInTheDocument());
  });

  it("keeps the selected model visible instead of filtering it out", async () => {
    // Selecting an option sets `value` to the model id, not the display name.
    // Filtering only on the display name would then match nothing and the note
    // would read "0 model(s) available" for a model that is plainly selected.
    mocks.fetchModelCatalog.mockResolvedValue(catalog());
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderPicker();

    await waitFor(() => expect(screen.getByTestId("model-picker-list")).toBeInTheDocument());
    const input = screen.getByRole("combobox") as HTMLInputElement;

    await user.type(input, "openai/gpt-4o-mini");
    await waitFor(() => expect(screen.getByText(/GPT-4o mini/i)).toBeInTheDocument());
    expect(screen.getByText(/3 model\(s\) available/)).toBeInTheDocument();
    expect(screen.queryByText(/No models match your search/i)).not.toBeInTheDocument();
  });

  it("keeps non-matching typed values because the combobox is freeform", async () => {
    mocks.fetchModelCatalog.mockResolvedValue(catalog());
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderPicker({ onChange });

    await waitFor(() => expect(screen.getByTestId("model-picker-list")).toBeInTheDocument());
    const input = screen.getByRole("combobox") as HTMLInputElement;

    await user.type(input, "my-custom-model");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("my-custom-model"));
  });

  it("tells the user to reconnect when the gateway no longer knows the connection", async () => {
    // The exact failure the dev gateway reports after a restart: the persisted
    // connection reference survived, the in-memory credential did not.
    mocks.fetchModelCatalog.mockRejectedValue(
      new GatewayError("Gateway does not know this connection", "unknownConnection", false, 404),
    );
    renderPicker();

    await waitFor(() =>
      expect(screen.getByText(/gateway no longer knows this connection/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Disconnect and connect again/i)).toBeInTheDocument();
    // Manual entry stays available: a user who knows the model id is not blocked.
    expect(screen.getByTestId("model-picker-manual")).toBeInTheDocument();
  });

  it("does not claim a reconnect is needed for an unrelated failure", async () => {
    mocks.fetchModelCatalog.mockRejectedValue(
      new GatewayError("Gateway server error 503", "serverError", true, 503),
    );
    renderPicker();

    await waitFor(() => expect(screen.getByTestId("model-picker-manual")).toBeInTheDocument());
    expect(screen.queryByText(/gateway no longer knows this connection/i)).not.toBeInTheDocument();
  });

  it("clears the reconnect notice once a later fetch succeeds", async () => {
    mocks.fetchModelCatalog.mockRejectedValue(
      new GatewayError("Gateway does not know this connection", "unknownConnection", false, 404),
    );
    renderPicker();
    await waitFor(() =>
      expect(screen.getByText(/gateway no longer knows this connection/i)).toBeInTheDocument(),
    );

    mocks.fetchModelCatalog.mockResolvedValue(catalog());
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Load model list/i }));

    await waitFor(() => expect(screen.getByTestId("model-picker-list")).toBeInTheDocument());
    expect(screen.queryByText(/gateway no longer knows this connection/i)).not.toBeInTheDocument();
  });
});
