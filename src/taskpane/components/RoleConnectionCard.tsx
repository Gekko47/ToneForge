import React from "react";
import { DefaultButton, MessageBar, MessageBarType, Toggle } from "@fluentui/react";
import type { LlmRole, LlmRoleBinding } from "../../core/domain/LlmRole";
import type { ProviderConnection } from "../../core/domain/ProviderConnection";
import { ConnectionTestButton } from "./ConnectionTestButton";
import ModelPicker from "./ModelPicker";
import { ROLE_LABELS } from "../settings/llmDashboardModel";

export interface RoleConnectionCardProps {
  role: LlmRole;
  binding: LlmRoleBinding | undefined;
  connection: ProviderConnection | undefined;
  generalBindingExists: boolean;
  gatewayOrigin: string;
  onModelChange: (model: string) => void;
  onReuseGeneralChange: (reuse: boolean) => void;
  onDisconnect: () => void;
}

/**
 * Presentational card for a single LLM role's connection.
 *
 * Shows the role's connection status, model, and test button. For the
 * decision role, offers the reuse-general toggle. All mutations are
 * delegated to callbacks — this component owns no state.
 */
export function RoleConnectionCard({
  role,
  binding,
  connection,
  generalBindingExists,
  gatewayOrigin,
  onModelChange,
  onReuseGeneralChange,
  onDisconnect,
}: RoleConnectionCardProps): React.ReactNode {
  const label = ROLE_LABELS[role];
  const configured = connection !== undefined && connection.status === "connected";
  const canReuseGeneral = role === "consistency_decision" && generalBindingExists;

  return (
    <section className="tf-role-connection-card" aria-label={label.title}>
      <h3 className="tf-role-title">{label.title}</h3>
      <p className="tf-sub">{label.description}</p>
      {configured ? (
        <>
          <MessageBar messageBarType={MessageBarType.success} delayedRender={false}>
            Connected — {connection.provider} ·{" "}
            {binding?.selectedModel ?? connection.selectedModel ?? "default model"}
          </MessageBar>
          <ConnectionTestButton connection={connection} gatewayOrigin={gatewayOrigin} />
          {canReuseGeneral ? (
            <Toggle
              label="Reuse general connection (different model)"
              checked={binding?.reuseGeneral === true}
              onChange={(_event, value) => onReuseGeneralChange(value ?? false)}
              onText="Reusing"
              offText="Separate"
            />
          ) : null}
          <ModelPicker
            provider={connection.provider}
            value={binding?.selectedModel ?? ""}
            onChange={onModelChange}
            catalog={null}
            onCatalogChange={() => {}}
          />
          <DefaultButton text="Disconnect" onClick={onDisconnect} />
        </>
      ) : (
        <MessageBar messageBarType={MessageBarType.info} delayedRender={false}>
          Not configured. Connect a provider to enable this role.
        </MessageBar>
      )}
    </section>
  );
}
