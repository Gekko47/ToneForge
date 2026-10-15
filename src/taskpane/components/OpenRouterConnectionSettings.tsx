import React from "react";
import { Button, Card, Field, Input, MessageBar } from "@fluentui/react-components";
import { createProviderGatewayClient, GatewayError, SessionTokenStore } from "../../ai/gateway";
import { isCatalogForConnection } from "../../ai/gateway/modelCatalog";
import type { ProviderConnection } from "../../core/domain/index";
import { loadState, saveState, type PersistedState } from "../../core/state/index";
import { logger } from "../../shared/utils/logger";
import {
  OPENROUTER_DEFAULT_BASE_URL,
  validateApiKeyInput,
  validateOpenRouterBaseUrl,
} from "../settings/settingsModel";
import ModelPicker from "./ModelPicker";

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
  onSelectModel: (modelId: string) => void;
  selectedModel: string;
}

type Phase = "idle" | "connecting" | "loadingModels" | "ready" | "error";

export default function OpenRouterConnectionSettings({
  gatewayOrigin,
  connection,
  onConnectionChange,
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

  function persistConnection(next: ProviderConnection | undefined): void {
    const current = loadState();
    const connections: NonNullable<PersistedState["providerConnections"]> = {
      ...(current.providerConnections ?? {}),
    };
    if (next) connections[next.connectionId] = next;
    else if (connection) delete connections[connection.connectionId];
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
        setError("The model list did not match the new connection. Reconnect to try again.");
        setPhase("error");
        return;
      }
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
    <section aria-label="OpenRouter connection">
      <Card className="tf-section" appearance="subtle">
        <MessageBar intent="info">
          Your OpenRouter API key is sent once to the local gateway and is not stored by ToneForge.
          Only the opaque connection reference the gateway returns is saved.
        </MessageBar>
        <Field
          label="OpenRouter base URL"
          hint="Where the gateway sends requests. The add-in never calls this address itself."
        >
          <Input value={baseUrl} onChange={(_event, data) => setBaseUrl(data.value)} />
        </Field>
        {connected ? (
          <>
            <MessageBar intent="warning">
              Connected. Disconnecting drops the credential on the gateway side and cannot be undone
              without entering the key again.
            </MessageBar>
            <Button
              onClick={() => {
                void disconnect();
              }}
              disabled={phase === "connecting"}
            >
              Disconnect OpenRouter
            </Button>
          </>
        ) : (
          <>
            <Field
              label="OpenRouter API key"
              hint="Submitted once, then cleared from the pane. It is never saved to settings or logs."
            >
              <Input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(_event, data) => setApiKey(data.value)}
              />
            </Field>
            <Button
              appearance="primary"
              onClick={() => {
                void connect();
              }}
              disabled={phase === "connecting" || phase === "loadingModels"}
            >
              Connect OpenRouter
            </Button>
          </>
        )}
        {error ? <MessageBar intent="error">{error}</MessageBar> : null}
        {connected ? (
          <ModelPicker
            provider={connection.provider}
            value={selectedModel}
            onChange={onSelectModel}
            connection={connection}
            gatewayOrigin={gatewayOrigin}
          />
        ) : null}
      </Card>
    </section>
  );
}
