import React from "react";
import { DefaultButton, Dropdown, MessageBar, MessageBarType, TextField } from "@fluentui/react";
import { createProviderGatewayClient, GatewayError, SessionTokenStore } from "../../ai/gateway";
import { isCatalogForConnection, resolveCatalogStatus } from "../../ai/gateway/modelCatalog";
import type { ModelCatalog, ProviderConnection } from "../../core/domain/index";
import { loadState, saveState, type PersistedState } from "../../core/state/index";
import { logger } from "../../shared/utils/logger";
import {
  OPENROUTER_DEFAULT_BASE_URL,
  validateApiKeyInput,
  validateOpenRouterBaseUrl,
  type ModelDropdownOption,
} from "../settings/settingsModel";

/**
 * OpenRouter connection controls.
 *
 * The credential rule this component exists to enforce: **the key is typed
 * here and goes nowhere else.** It is held in component state, sent once to the
 * gateway over the same-origin loopback channel, and dropped the moment that
 * request settles — success or failure. It is never placed in
 * `PersistedState`, never in the `LlmSettingsDraft`, never logged, and never
 * rendered back to the user. Only the opaque connection reference the gateway
 * issues is persisted, and that reference is not a credential.
 *
 * The gateway client and its session token are created inside this component
 * rather than at module scope so the token store is discarded on unmount and
 * cannot outlive the pane.
 */

export interface OpenRouterConnectionSettingsProps {
  /** The loopback gateway origin the key is submitted to. */
  gatewayOrigin: string;
  /** The currently persisted connection, if one exists. */
  connection: ProviderConnection | undefined;
  /**
   * Called with the connection that was just persisted.
   *
   * The parent owns the persisted record; without this the pane would keep
   * showing the pre-connect state after a successful connect, because saving to
   * `PersistedState` does not re-render anything on its own.
   */
  onConnectionChange?: (connection: ProviderConnection | undefined) => void;
  /** Models the provider offered, once a catalog has been fetched. */
  models: ModelDropdownOption[];
  catalog: ModelCatalog | null;
  onCatalogChange: (catalog: ModelCatalog | null) => void;
  onSelectModel: (modelId: string) => void;
  selectedModel: string;
}

type Phase = "idle" | "connecting" | "loadingModels" | "ready" | "error";

export default function OpenRouterConnectionSettings({
  gatewayOrigin,
  connection,
  onConnectionChange,
  models,
  catalog,
  onCatalogChange,
  onSelectModel,
  selectedModel,
}: OpenRouterConnectionSettingsProps): React.ReactNode {
  const [apiKey, setApiKey] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState(OPENROUTER_DEFAULT_BASE_URL);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [error, setError] = React.useState<string | null>(null);
  // One client, one token store, both discarded on unmount.
  const session = React.useRef<{ client: ReturnType<typeof createProviderGatewayClient> } | null>(
    null,
  );

  function client(): ReturnType<typeof createProviderGatewayClient> {
    if (session.current === null) {
      session.current = {
        client: createProviderGatewayClient({
          origin: gatewayOrigin,
          tokenStore: new SessionTokenStore(),
        }),
      };
    }
    return session.current.client;
  }

  React.useEffect(
    () => () => {
      session.current = null;
    },
    [],
  );

  const connected = connection !== undefined;
  const catalogStatus = resolveCatalogStatus({
    loading: phase === "loadingModels",
    offline: false,
    failed: phase === "error",
    catalog,
    now: new Date(),
  });

  function persistConnection(next: ProviderConnection | undefined): void {
    const current = loadState();
    const connections: NonNullable<PersistedState["providerConnections"]> = {
      ...(current.providerConnections ?? {}),
    };
    if (next) connections.openrouter = next;
    else delete connections.openrouter;
    saveState({ ...current, providerConnections: connections });
    onConnectionChange?.(next);
  }

  /**
   * Forget the typed key before the request is even attempted to fail.
   *
   * The value is copied into a local for the call, then the field is cleared in
   * a `finally`, so a network error, a 401, or a thrown validation error all
   * leave the same clean state.
   */
  async function connect(): Promise<void> {
    const baseError = validateOpenRouterBaseUrl(baseUrl);
    if (baseError) {
      setError(baseError);
      setPhase("error");
      return;
    }
    const keyError = validateApiKeyInput(apiKey);
    if (keyError) {
      setError(keyError);
      setPhase("error");
      return;
    }

    const submitted = apiKey.trim();
    setApiKey("");
    setError(null);
    setPhase("connecting");
    try {
      const issued = await client().submitBrokerApiKey("openrouter", submitted, baseUrl.trim());
      persistConnection(issued);
      setPhase("loadingModels");
      const fetched = await client().fetchModelCatalog(issued);
      // A catalog that somehow belongs to another connection is discarded
      // rather than shown: the dropdown would then offer models the current
      // credential cannot use.
      if (!isCatalogForConnection(fetched, issued)) {
        onCatalogChange(null);
        setError("The model list did not match the new connection. Reconnect to try again.");
        setPhase("error");
        return;
      }
      onCatalogChange(fetched);
      // The connection id is a credential-adjacent reference, so the log records
      // only that a connection exists and how many models it offers.
      logger.info("OpenRouter connection established", {
        provider: "openrouter",
        modelCount: fetched.models.length,
      });
      setPhase("ready");
    } catch (caught: unknown) {
      // A refused key leaves no connection behind, and the user can retry
      // without the pane holding anything sensitive.
      setError(describeConnectFailure(caught));
      setPhase("error");
    }
  }

  async function disconnect(): Promise<void> {
    const existing = connection;
    if (existing === undefined) return;
    setError(null);
    try {
      await client().disconnect(existing);
    } catch (caught: unknown) {
      // The local record is cleared regardless: leaving a `connected` record
      // behind after the user pressed Disconnect would be the worse failure.
      logger.warn("OpenRouter disconnect call failed; clearing the local record anyway", {
        kind: caught instanceof Error ? caught.name : "unknown",
      });
    }
    persistConnection(undefined);
    onCatalogChange(null);
    setPhase("idle");
  }

  /**
   * Turn a failed connect into something the user can act on.
   *
   * A gateway refusal carries its own explanation ("rejected the session",
   * "forbidden") and showing it verbatim saves the user guessing. Anything else
   * is a transport failure, which almost always means the local broker is not
   * running, so that is what the message says. Raw transport error text is not
   * echoed, because it can name an internal address the user cannot act on.
   */
  function describeConnectFailure(caught: unknown): string {
    if (caught instanceof GatewayError) return caught.message;
    return "Could not reach the provider gateway. Check that the local broker is running.";
  }

  return (
    <section aria-label="OpenRouter connection" className="tf-collapsible">
      <MessageBar messageBarType={MessageBarType.info} delayedRender={false}>
        Your OpenRouter API key is sent once to the local gateway and is not stored by ToneForge.
        Only the opaque connection reference the gateway returns is saved.
      </MessageBar>
      <TextField
        label="OpenRouter base URL"
        value={baseUrl}
        onChange={(_event, value) => setBaseUrl(value ?? "")}
        description="Where the gateway sends requests. The add-in never calls this address itself."
      />
      {connected ? (
        <>
          <MessageBar messageBarType={MessageBarType.severeWarning} delayedRender={false}>
            Connected. Disconnecting drops the credential on the gateway side and cannot be undone
            without entering the key again.
          </MessageBar>
          <DefaultButton
            text="Disconnect OpenRouter"
            onClick={() => {
              void disconnect();
            }}
            disabled={phase === "connecting"}
          />
        </>
      ) : (
        <>
          <TextField
            label="OpenRouter API key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(_event, value) => setApiKey(value ?? "")}
            description="Submitted once, then cleared from the pane. It is never saved to settings or logs."
          />
          <DefaultButton
            text="Connect OpenRouter"
            primary
            onClick={() => {
              void connect();
            }}
            disabled={phase === "connecting" || phase === "loadingModels"}
          />
        </>
      )}
      {error ? (
        <MessageBar messageBarType={MessageBarType.error} delayedRender={false}>
          {error}
        </MessageBar>
      ) : null}
      {connected ? (
        <MessageBar messageBarType={MessageBarType.info} delayedRender={false}>
          {describeCatalog(catalogStatus, models.length)}
        </MessageBar>
      ) : null}
      {connected ? (
        <ModelPicker models={models} selectedModel={selectedModel} onSelect={onSelectModel} />
      ) : null}
    </section>
  );
}

function describeCatalog(status: ReturnType<typeof resolveCatalogStatus>, count: number): string {
  switch (status) {
    case "loading":
      return "Loading the model list…";
    case "failed":
      return "The model list could not be loaded. Reconnect to retry.";
    case "stale":
      return "The model list is out of date. Reconnect to refresh it.";
    case "empty":
      return "This account has no models available on OpenRouter.";
    case "idle":
      return "Choose a model, or leave the deployment default in place.";
    default:
      return `${count} model${count === 1 ? "" : "s"} available.`;
  }
}

/**
 * The model list, offered only once a connection can actually serve it.
 *
 * A typed model name stays the fallback everywhere else: forcing a user onto a
 * fetched list would make a working configuration depend on a catalog request
 * succeeding at the moment they open Settings.
 */
function ModelPicker({
  models,
  selectedModel,
  onSelect,
}: {
  models: ModelDropdownOption[];
  selectedModel: string;
  onSelect: (modelId: string) => void;
}): React.ReactNode {
  if (models.length === 0) {
    return null;
  }
  const selected = models.find((model) => model.key === selectedModel);
  return (
    <>
      <Dropdown
        label="Model"
        selectedKey={selectedModel.length > 0 ? selectedModel : null}
        options={models.map((model) => ({ key: model.key, text: model.text, title: model.detail }))}
        onChange={(_event, option) => {
          if (typeof option?.key === "string") onSelect(option.key);
        }}
      />
      <p className="tf-settings-note">
        {selected?.detail ?? "Choose a model. Leaving this unset uses the provider's default."}
      </p>
    </>
  );
}
