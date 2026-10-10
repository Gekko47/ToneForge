import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Combobox, Field, Input, MessageBar, Option } from "@fluentui/react-components";
import { createProviderGatewayClient, SessionTokenStore } from "../../ai/gateway";
import { isCatalogForConnection, resolveCatalogStatus } from "../../ai/gateway/modelCatalog";
import { env } from "../../core/config/env";
import type { ModelCatalog, ProviderConnection, ProviderId } from "../../core/domain/index";
import { loadState } from "../../core/state/index";
import { logger } from "../../shared/utils/logger";
import { buildModelOptions } from "../settings/settingsModel";

export interface ModelPickerProps {
  provider: ProviderId;
  value: string;
  onChange: (modelId: string) => void;
  /** Catalog already fetched by the connect flow, when one has. */
  catalog: ModelCatalog | null;
  onCatalogChange: (catalog: ModelCatalog | null) => void;
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
 * The catalog is a convenience, not a gate. An unreachable provider, an expired
 * list, or a deployment-managed credential with no browsable catalog all fall
 * back to manual entry rather than blocking configuration entirely.
 */
export default function ModelPicker({
  provider,
  value,
  onChange,
  catalog,
  onCatalogChange,
}: ModelPickerProps): React.ReactNode {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [manual, setManual] = useState(false);
  // The gateway client and its session token are created here and discarded on
  // unmount so they cannot outlive the pane.
  const session = useRef<{ client: ReturnType<typeof createProviderGatewayClient> } | null>(null);

  const connection: ProviderConnection | undefined =
    provider === "mock" ? undefined : loadState().providerConnections?.[provider];

  const client = useCallback((): ReturnType<typeof createProviderGatewayClient> => {
    if (session.current === null) {
      session.current = {
        client: createProviderGatewayClient({
          origin: env.LLM_BROKER_URL ?? "",
          tokenStore: new SessionTokenStore(),
        }),
      };
    }
    return session.current.client;
  }, []);

  useEffect(
    () => () => {
      session.current = null;
    },
    [],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (connection === undefined) return;
    setLoading(true);
    setFailed(false);
    try {
      const fetched = await client().fetchModelCatalog(connection);
      // A catalog belonging to another connection is discarded: offering models
      // this credential cannot serve would be worse than offering none.
      const usable = isCatalogForConnection(fetched, connection);
      onCatalogChange(usable ? fetched : null);
      setFailed(!usable);
    } catch (error: unknown) {
      logger.warn("Model catalog could not be loaded", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      onCatalogChange(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [client, connection, onCatalogChange]);

  // Refetch whenever the provider or its connection changes. A list belonging to
  // the previous credential must never be shown against the new one.
  useEffect(() => {
    void refresh();
  }, [refresh]);

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
          {options.map((option) => (
            <Option key={option.key} value={option.key} title={option.detail}>
              {option.text}
            </Option>
          ))}
        </Combobox>
      </Field>
      <p className="tf-settings-note">
        {options.length} model(s) available on this connection. Leave blank to use the provider's
        own default.
      </p>
      <div className="tf-settings-actions">
        <Button onClick={() => void refresh()} disabled={loading}>
          Refresh model list
        </Button>
        <Button onClick={() => setManual(true)} aria-expanded={manual}>
          Enter a model id manually
        </Button>
      </div>
      {manual ? (
        <Field label="Model id" hint="Use this only if the list is missing the model you need.">
          <Input value={value} onChange={(_event, data) => onChange(data.value)} />
        </Field>
      ) : null}
      {status === "stale" ? (
        <MessageBar intent="warning" role="status">
          The model list is out of date. Refresh it before choosing.
        </MessageBar>
      ) : null}
    </div>
  );
}
