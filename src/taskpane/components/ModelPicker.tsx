import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ComboBox,
  DefaultButton,
  MessageBar,
  MessageBarType,
  TextField,
  type IComboBoxOption,
} from "@fluentui/react";
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
      <TextField
        label="Model"
        value={value}
        onChange={(_event, next) => onChange(next ?? "")}
        placeholder="gpt-4o-mini"
        description="Leave blank to use the provider's default model. This provider has no active connection, so its model list is unavailable."
      />
    );
  }

  if (!showList) {
    return (
      <div data-testid="model-picker-manual">
        <TextField
          label="Model"
          value={value}
          onChange={(_event, next) => onChange(next ?? "")}
          placeholder="gpt-4o-mini"
          description={
            status === "loading"
              ? "Loading the models this connection can use…"
              : "Enter a model id manually. The provider did not return a list of models."
          }
        />
        <div className="tf-settings-actions">
          <DefaultButton
            text={status === "stale" ? "Reload model list" : "Load model list"}
            onClick={() => void refresh()}
            disabled={loading}
          />
        </div>
      </div>
    );
  }

  return (
    <div data-testid="model-picker-list">
      <ComboBox
        label="Model"
        selectedKey={value}
        options={options}
        onChange={(_event, option?: IComboBoxOption) => onChange(String(option?.key ?? ""))}
        allowFreeInput
        autoComplete="off"
        placeholder="Select or type a model"
      />
      <p className="tf-settings-note">
        {options.length} model(s) available on this connection. Leave blank to use the provider's
        own default.
      </p>
      <div className="tf-settings-actions">
        <DefaultButton
          text="Refresh model list"
          onClick={() => void refresh()}
          disabled={loading}
        />
        <DefaultButton
          text="Enter a model id manually"
          onClick={() => setManual(true)}
          aria-expanded={manual}
        />
      </div>
      {manual ? (
        <TextField
          label="Model id"
          value={value}
          onChange={(_event, next) => onChange(next ?? "")}
          description="Use this only if the list is missing the model you need."
        />
      ) : null}
      {status === "stale" ? (
        <MessageBar messageBarType={MessageBarType.warning} role="status">
          The model list is out of date. Refresh it before choosing.
        </MessageBar>
      ) : null}
    </div>
  );
}
