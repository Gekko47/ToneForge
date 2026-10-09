import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsDashboard } from "../../../../src/taskpane/components/SettingsDashboard";
import type { PersistedState } from "../../../../src/core/state/persistence";
import { ProviderConnectionSchema } from "../../../../src/core/domain/ProviderConnection";
import { LlmRoleBindingsSchema } from "../../../../src/core/domain/LlmRole";

/*
 * The heavy children (ModelPicker, ConnectionTestButton, OpenRouterConnectionSettings)
 * have their own tests. What is tested here is the dashboard's orchestration:
 * binding a role, disconnecting, the reuse-general toggle, the connect flow,
 * and the info message when no general binding exists.
 */

vi.mock("../../../../src/core/config/env", () => ({
  env: { LLM_BROKER_URL: "https://localhost:3000" },
}));

vi.mock("../../../../src/taskpane/components/ModelPicker", () => ({
  default: () => <div data-testid="model-picker" />,
}));

vi.mock("../../../../src/taskpane/components/ConnectionTestButton", () => ({
  ConnectionTestButton: () => <div data-testid="connection-test-button" />,
}));

vi.mock("../../../../src/taskpane/components/OpenRouterConnectionSettings", () => ({
  default: (props: { onConnectionChange?: (conn: unknown) => void }) => (
    <div data-testid="openrouter-settings">
      <button
        type="button"
        onClick={() =>
          props.onConnectionChange?.(
            ProviderConnectionSchema.parse({
              connectionId: "conn-openrouter-1",
              provider: "openrouter",
              authMode: "brokerApiKey",
              status: "connected",
            }),
          )
        }
      >
        Connect OpenRouter
      </button>
    </div>
  ),
}));

function makeConnection(
  id: string,
  provider: "openai" | "anthropic" | "openrouter",
  overrides: Record<string, unknown> = {},
) {
  return ProviderConnectionSchema.parse({
    connectionId: id,
    provider,
    authMode: provider === "openrouter" ? "brokerApiKey" : "deploymentManaged",
    status: "connected",
    ...overrides,
  });
}

function makeState(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    settings: {
      llmProvider: "mock",
      openAiBaseUrl: "",
      openAiModel: "",
      autoScan: true,
      consistencyReviewConsent: false,
      semanticOptIn: false,
      decisionFallbackPolicy: "unresolved",
    },
    llmRoleBindings: {},
    providerConnections: {},
    ...overrides,
  } as PersistedState;
}

function firstStateChangeArg(onStateChange: ReturnType<typeof vi.fn>): PersistedState {
  const call = onStateChange.mock.calls[0];
  if (!call) throw new Error("onStateChange was not called");
  return call[0] as PersistedState;
}

describe("SettingsDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders both role connection cards", () => {
    const state = makeState();
    render(<SettingsDashboard state={state} onStateChange={vi.fn()} />);

    expect(screen.getByText("General LLM")).toBeInTheDocument();
    expect(screen.getByText("Consistency decision LLM")).toBeInTheDocument();
  });

  it("shows an info message when no general binding exists", () => {
    const state = makeState();
    render(<SettingsDashboard state={state} onStateChange={vi.fn()} />);

    expect(screen.getByText(/no general llm binding is configured yet/i)).toBeInTheDocument();
  });

  it("hides the info message when a general binding exists", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
    });
    const conns = { c1: makeConnection("c1", "openai") };
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });
    render(<SettingsDashboard state={state} onStateChange={vi.fn()} />);

    expect(screen.queryByText(/no general llm binding is configured yet/i)).not.toBeInTheDocument();
  });

  it("shows 'Not configured' for an unbound role", () => {
    const state = makeState();
    render(<SettingsDashboard state={state} onStateChange={vi.fn()} />);

    expect(screen.getAllByText(/not configured/i).length).toBeGreaterThan(0);
  });

  it("shows the connected provider and model for a bound role", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      general: {
        role: "general",
        provider: "openai",
        connectionId: "c1",
        selectedModel: "gpt-4",
      },
    });
    const conns = { c1: makeConnection("c1", "openai") };
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });
    render(<SettingsDashboard state={state} onStateChange={vi.fn()} />);

    expect(screen.getByText(/connected — openai · gpt-4/i)).toBeInTheDocument();
  });

  it("shows the reuse-general toggle only for the decision role when general is bound", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
      consistency_decision: {
        role: "consistency_decision",
        provider: "anthropic",
        connectionId: "c2",
      },
    });
    const conns = {
      c1: makeConnection("c1", "openai"),
      c2: makeConnection("c2", "anthropic"),
    };
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });
    render(<SettingsDashboard state={state} onStateChange={vi.fn()} />);

    expect(screen.getByText(/reuse general connection/i)).toBeInTheDocument();
  });

  it("hides the reuse-general toggle when no general binding exists", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      consistency_decision: {
        role: "consistency_decision",
        provider: "anthropic",
        connectionId: "c2",
      },
    });
    const conns = { c2: makeConnection("c2", "anthropic") };
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });
    render(<SettingsDashboard state={state} onStateChange={vi.fn()} />);

    expect(screen.queryByText(/reuse general connection/i)).not.toBeInTheDocument();
  });

  it("shows the reuse-general toggle for a stale decision binding when general is bound", () => {
    // The decision binding's connection is gone, but the binding itself still
    // exists — the toggle must be reachable so the user can switch to reusing
    // the general connection instead of being stuck with a dead binding.
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
      consistency_decision: {
        role: "consistency_decision",
        provider: "anthropic",
        connectionId: "c2",
      },
    });
    const conns = { c1: makeConnection("c1", "openai") };
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });
    render(<SettingsDashboard state={state} onStateChange={vi.fn()} />);

    expect(screen.getByText(/reuse general connection/i)).toBeInTheDocument();
  });

  it("connects a new binding when the connect section reports a connection", async () => {
    const onStateChange = vi.fn();
    const state = makeState();
    render(<SettingsDashboard state={state} onStateChange={onStateChange} />);

    await userEvent.click(screen.getByText("Connect OpenRouter"));

    const nextState = firstStateChangeArg(onStateChange);
    expect(nextState.llmRoleBindings?.general).toBeDefined();
    expect(nextState.llmRoleBindings?.general?.connectionId).toBe("conn-openrouter-1");
    // The connection must be merged into providerConnections in the same call,
    // or the just-persisted connection is dropped by the stale state prop.
    expect(nextState.providerConnections?.["conn-openrouter-1"]).toBeDefined();
  });

  it("disconnects a role by removing its binding and unreferenced connection", async () => {
    const onStateChange = vi.fn();
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
    });
    const conns = { c1: makeConnection("c1", "openai") };
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });
    render(<SettingsDashboard state={state} onStateChange={onStateChange} />);

    await userEvent.click(screen.getByText("Disconnect"));

    const nextState = firstStateChangeArg(onStateChange);
    expect(nextState.llmRoleBindings?.general).toBeUndefined();
    expect(nextState.providerConnections?.["c1"]).toBeUndefined();
  });

  it("keeps a shared connection when another binding still references it", async () => {
    // The decision role reuses the general connection, so disconnecting the
    // decision role must not delete the connection the general role still uses.
    const onStateChange = vi.fn();
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
      consistency_decision: {
        role: "consistency_decision",
        provider: "openai",
        connectionId: "c1",
        reuseGeneral: true,
      },
    });
    const conns = { c1: makeConnection("c1", "openai") };
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });
    render(<SettingsDashboard state={state} onStateChange={onStateChange} />);

    // Both roles render a Disconnect button; disconnect the decision role.
    const decisionCard = screen.getByLabelText("Consistency decision LLM");
    await userEvent.click(within(decisionCard).getByText("Disconnect"));

    const nextState = firstStateChangeArg(onStateChange);
    expect(nextState.llmRoleBindings?.consistency_decision).toBeUndefined();
    expect(nextState.providerConnections?.["c1"]).toBeDefined();
  });

  it("toggles reuse-general for the decision role", async () => {
    const onStateChange = vi.fn();
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
      consistency_decision: {
        role: "consistency_decision",
        provider: "anthropic",
        connectionId: "c2",
      },
    });
    const conns = {
      c1: makeConnection("c1", "openai"),
      c2: makeConnection("c2", "anthropic"),
    };
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });
    render(<SettingsDashboard state={state} onStateChange={onStateChange} />);

    await userEvent.click(screen.getByText(/reuse general connection/i));

    const nextState = firstStateChangeArg(onStateChange);
    expect(nextState.llmRoleBindings?.consistency_decision?.reuseGeneral).toBe(true);
  });

  it("renders the model picker for a configured role", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      general: {
        role: "general",
        provider: "openai",
        connectionId: "c1",
        selectedModel: "gpt-4",
      },
    });
    const conns = { c1: makeConnection("c1", "openai") };
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });
    render(<SettingsDashboard state={state} onStateChange={vi.fn()} />);

    expect(screen.getByTestId("model-picker")).toBeInTheDocument();
  });
});
