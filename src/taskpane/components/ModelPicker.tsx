import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Combobox, Field, Input, MessageBar, Option } from "@fluentui/react-components";
import { createProviderGatewayClient, GatewayError, SessionTokenStore } from "../../ai/gateway";
import { resolveCatalogStatus } from "../../ai/gateway/modelCatalog";
import { env } from "../../core/config/env";
import type { ModelCatalog, ProviderConnection, ProviderId } from "../../core/domain/index";
import { logger } from "../../shared/utils/logger";
import { buildModelOptions } from "../settings/settingsModel";

export interface ModelPickerProps {
  provider: ProviderId;
  value: string;
  onChange: (modelId: string) => void;
  /** The connection to fetch the model catalog for. */
  connection: ProviderConnection | undefined;
  /** The gateway origin to use for model fetching. */
  gatewayOrigin: string;
}

/**
 * Model selection, offered as the provider's list rather than a typed guess.
 *
 * A free-text model field asks the user to know a provider's internal model
 * identifiers and gives them no way to know whether the one they typed exists.
 * The gateway already exposes `GET /v1/connections/:id/models` for every
 * provider it brokers, so the list is fetched from the same source that will
 * serve the request and offered as a searchable combo box.
 *
 * The Fluent v9 Combobox does not filter its own options — it shows every
 * child `Option` regardless of input. We filter `options` by the current
 * `value` (a case-insensitive substring match against the option text *and*
 * the model id) before passing them as children, so typing `haiku` narrows the
 * list to `claude-3-haiku-20240307`. Matching the id as well as the display
 * name matters because selecting an option sets `value` to the model id, not
 * the display name: without it, a selected model would filter itself out and
 * the list would read "0 model(s) available". The Combobox is `freeform`, so a
 * non-matching typed value is still accepted and persisted.
 *
 * `autoComplete="off"` is deliberate: it disables the browser's native
 * autofill dropdown, which would otherwise stack a second suggestion list on
 * top of our filtered one.
 *
 * The ResizeObserver feedback loop that used to fire while filtering is fixed
 * once for the whole pane by `PositioningConfigurationProvider` in
 * `FluentV9Provider.tsx`, not per component here — every Fluent popup in the
 * pane (this Combobox and the six Dropdowns) shares the same positioning
 * configuration.
 *
 * The catalog is a convenience, not a gate. When it is unavailable — an
 * unreachable provider, an expired list, a deployment-managed credential with
 * no browsable catalog, or a connection the gateway no longer knows — the
 * component falls back to a plain manual input rather than blocking
 * configuration entirely.
 */
export default function ModelPicker({
  provider,
  value,
  onChange,
  connection,
  gatewayOrigin,
}: ModelPickerProps): React.ReactNode {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // A connection the gateway no longer knows is a different failure from a
  // transient one: no amount of retrying will produce a list, so the picker
  // says "reconnect" instead of offering a retry that cannot succeed.
  const [unknownConnection, setUnknownConnection] = useState(false);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  // The gateway client and its session token are created here and discarded on
  // unmount so they cannot outlive the pane.
  const session = useRef<{ client: ReturnType<typeof createProviderGatewayClient> } | null>(null);
  // The connection id of the most recent catalog request. A response whose id
  // no longer matches was superseded by a newer connection and is discarded.
  const catalogConnectionId = useRef<string | undefined>(undefined);
  // The latest connection, read inside `refresh` so that callback can stay
  // referentially stable: a parent that rebuilds the connection object on every
  // render must not retrigger the fetch effect.
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const connectionId = connection?.connectionId;

  const client = useCallback((): ReturnType<typeof createProviderGatewayClient> => {
    if (session.current === null) {
      session.current = {
        client: createProviderGatewayClient({
          origin: gatewayOrigin || env.LLM_BROKER_URL || "",
          tokenStore: new SessionTokenStore(),
        }),
      };
    }
    return session.current.client;
  }, [gatewayOrigin]);

  useEffect(
    () => () => {
      session.current = null;
    },
    [],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const active = connectionRef.current;
    if (active === undefined) return;
    // Claim the request before awaiting, so a response that lands after the
    // connection changed can be recognised as stale and dropped.
    const requestConnectionId = active.connectionId;
    catalogConnectionId.current = requestConnectionId;
    // Clear the catalog when starting a fetch for a new connection, so a stale
    // list from the previous connection is never shown while loading.
    setCatalog(null);
    setLoading(true);
    setFailed(false);
    setUnknownConnection(false);
    try {
      const fetched = await client().fetchModelCatalog(active);
      // Discard the response if the active connection has changed since this
      // request started — offering models from another connection would be
      // worse than offering none.
      if (catalogConnectionId.current !== requestConnectionId) {
        return;
      }
      setCatalog(fetched);
      setFailed(false);
    } catch (error: unknown) {
      // Only update error state if this is still the active connection.
      if (catalogConnectionId.current === requestConnectionId) {
        logger.warn("Model catalog could not be loaded", {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        setCatalog(null);
        setFailed(true);
        setUnknownConnection(error instanceof GatewayError && error.kind === "unknownConnection");
      }
    } finally {
      if (catalogConnectionId.current === requestConnectionId) {
        setLoading(false);
      }
    }
  }, [client]);

  // Refetch whenever the connection changes. A list belonging to the previous
  // credential must never be shown against the new one.
  useEffect(() => {
    void refresh();
  }, [refresh, connectionId]);

  const status = resolveCatalogStatus({
    loading,
    offline: false,
    failed,
    catalog,
    now: new Date(),
  });
  const options = catalog === null ? [] : buildModelOptions(catalog.models);
  const showList = catalog !== null && options.length > 0;

  if (provider === "mock") {
    return (
      <p className="tf-sub" data-testid="model-picker-na">
        The offline stub answers every request itself and has no model to select.
      </p>
    );
  }

  if (connection === undefined) {
    return (
      <Field
        label="Model"
        hint="Leave blank to use the provider's default model. This provider has no active connection, so its model list is unavailable."
      >
        <Input
          value={value}
          onChange={(_event, data) => onChange(data.value)}
          placeholder="gpt-4o-mini"
        />
      </Field>
    );
  }

  if (!showList) {
    return (
      <div data-testid="model-picker-manual">
        {unknownConnection ? (
          <MessageBar intent="warning">
            The gateway no longer knows this connection, so it cannot list the models it can use.
            Disconnect and connect again to re-establish it.
          </MessageBar>
        ) : null}
        <Field
          label="Model"
          hint={
            status === "loading"
              ? "Loading the models this connection can use…"
              : "Enter a model id manually. The provider did not return a list of models."
          }
        >
          <Input
            value={value}
            onChange={(_event, data) => onChange(data.value)}
            placeholder="gpt-4o-mini"
          />
        </Field>
        <div className="tf-settings-actions">
          <Button onClick={() => void refresh()} disabled={loading}>
            {status === "stale" ? "Reload model list" : "Load model list"}
          </Button>
        </div>
      </div>
    );
  }

  const query = value.trim().toLowerCase();
  const filtered = query
    ? options.filter(
        (option) =>
          option.text.toLowerCase().includes(query) || option.key.toLowerCase().includes(query),
      )
    : options;

  return (
    <div data-testid="model-picker-list">
      <Field label="Model">
        <Combobox
          value={value}
          selectedOptions={value ? [value] : []}
          freeform
          autoComplete="off"
          placeholder="Select or type a model"
          onChange={(event) => {
            const target = event.target as HTMLInputElement;
            onChange(target.value);
          }}
          onOptionSelect={(_event, data) => {
            if (data.optionValue) onChange(data.optionValue);
          }}
        >
          {filtered.map((option) => (
            <Option key={option.key} value={option.key} title={option.detail}>
              {option.text}
            </Option>
          ))}
        </Combobox>
      </Field>
      {filtered.length === 0 ? <p className="tf-sub">No models match your search.</p> : null}
      <p className="tf-settings-note">
        {options.length} model(s) available on this connection. Leave blank to use the provider's
        own default.
      </p>
      <div className="tf-settings-actions">
        <Button onClick={() => void refresh()} disabled={loading}>
          Refresh model list
        </Button>
      </div>
      {status === "stale" ? (
        <MessageBar intent="warning" role="status">
          The model list is out of date. Refresh it before choosing.
        </MessageBar>
      ) : null}
    </div>
  );
}
