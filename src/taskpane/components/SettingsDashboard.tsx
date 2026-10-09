import React from "react";
import { MessageBar, MessageBarType } from "@fluentui/react";
import { env } from "../../core/config/env";
import type { PersistedState } from "../../core/state/persistence";
import type { LlmRole } from "../../core/domain/LlmRole";
import type { ProviderConnection } from "../../core/domain/ProviderConnection";
import { logger } from "../../shared/utils/logger";
import { removeRoleBinding, setReuseGeneral, setRoleBinding } from "../settings/llmRoles";
import { buildRoleConnectionViews } from "../settings/llmDashboardModel";
import { connectionForRole } from "../settings/providerComposition";
import { createProviderGatewayClient, SessionTokenStore } from "../../ai/gateway";
import { RoleConnectionCard } from "./RoleConnectionCard";
import { RedactionSettingsSection } from "./RedactionSettingsSection";
import OpenRouterConnectionSettings from "./OpenRouterConnectionSettings";

export interface SettingsDashboardProps {
  state: PersistedState;
  onStateChange: (next: PersistedState) => void;
}

/**
 * The LLM settings dashboard.
 *
 * Composes the role connection cards and the redaction/consent section.
 * Owns the persisted-state mutations for role bindings and consent; the
 * presentational cards own no state.
 */
export function SettingsDashboard({
  state,
  onStateChange,
}: SettingsDashboardProps): React.ReactNode {
  const views = buildRoleConnectionViews(state);
  const generalBindingExists = state.llmRoleBindings?.general !== undefined;
  const gatewayOrigin = env.LLM_BROKER_URL ?? "";

  function updateBindings(
    mutate: (bindings: PersistedState["llmRoleBindings"]) => PersistedState["llmRoleBindings"],
  ): void {
    const next = mutate(state.llmRoleBindings);
    onStateChange({ ...state, llmRoleBindings: next });
  }

  function handleReuseGeneralChange(role: LlmRole, reuse: boolean): void {
    if (role !== "consistency_decision") return;
    try {
      updateBindings((bindings) => setReuseGeneral(bindings, reuse));
    } catch (caught: unknown) {
      // A reuse toggle with no general binding is a no-op rather than a crash.
      logger.warn("Could not set reuse-general", {
        reason: caught instanceof Error ? caught.message : "unknown",
      });
    }
  }

  function handleModelChange(role: LlmRole, model: string): void {
    const binding = state.llmRoleBindings?.[role];
    if (!binding) return;
    try {
      updateBindings((bindings) => setRoleBinding(bindings, { ...binding, selectedModel: model }));
    } catch (caught: unknown) {
      logger.warn("Could not set role model", {
        reason: caught instanceof Error ? caught.message : "unknown",
      });
    }
  }

  function handleDisconnect(role: LlmRole): void {
    const binding = state.llmRoleBindings?.[role];
    if (!binding) return;
    const connectionId = binding.connectionId;
    const nextBindings = removeRoleBinding(state.llmRoleBindings, role);
    const current = state.providerConnections ?? {};
    // Delete the connection only when no remaining binding references it. A
    // decision binding with `reuseGeneral` resolves through the general binding,
    // so "referenced" is computed the same way `connectionForRole` resolves it —
    // otherwise disconnecting one role would delete a connection another shares.
    const stillReferenced = (["general", "consistency_decision"] as LlmRole[]).some(
      (other) => connectionForRole(other, nextBindings, current)?.connectionId === connectionId,
    );
    const nextConnections = { ...current };
    if (!stillReferenced) {
      delete nextConnections[connectionId];
    }
    onStateChange({
      ...state,
      llmRoleBindings: nextBindings,
      providerConnections: nextConnections,
    });
    // Best-effort gateway disconnect: the local state change stays synchronous so
    // the UI reflects the disconnect immediately, and a gateway failure is logged
    // rather than thrown.
    const connection = current[connectionId];
    if (connection !== undefined) {
      const client = createProviderGatewayClient({
        origin: gatewayOrigin,
        tokenStore: new SessionTokenStore(),
      });
      void client.disconnect(connection).catch((caught: unknown) => {
        logger.warn("Could not disconnect connection at the gateway", {
          reason: caught instanceof Error ? caught.message : "unknown",
        });
      });
    }
  }

  function handleConnect(role: LlmRole, connection: ProviderConnection): void {
    try {
      // The connection is merged into `providerConnections` in the same
      // `onStateChange` call as the binding. `OpenRouterConnectionSettings`
      // persists the connection before calling back, so the `state` prop is stale
      // by the time this runs — setting only the binding would drop the
      // just-persisted connection.
      onStateChange({
        ...state,
        llmRoleBindings: setRoleBinding(state.llmRoleBindings, {
          role,
          provider: connection.provider,
          connectionId: connection.connectionId,
          reuseGeneral: false,
          ...(connection.selectedModel ? { selectedModel: connection.selectedModel } : {}),
        }),
        providerConnections: {
          ...(state.providerConnections ?? {}),
          [connection.connectionId]: connection,
        },
      });
    } catch (caught: unknown) {
      logger.warn("Could not bind role to connection", {
        reason: caught instanceof Error ? caught.message : "unknown",
      });
    }
  }

  return (
    <div className="tf-settings-dashboard">
      <h2 className="tf-title">LLM connections</h2>
      <p className="tf-sub">
        Two independent LLM roles. The general LLM handles semantic review and consistency
        extraction; the decision LLM adjudicates bounded ambiguity. Each role binds to its own
        connection, or the decision role can reuse the general connection with a different model.
      </p>
      {views.map((view) => (
        <RoleConnectionCard
          key={view.role}
          role={view.role}
          binding={view.binding}
          connection={view.connection}
          generalBindingExists={generalBindingExists}
          gatewayOrigin={gatewayOrigin}
          onModelChange={(model) => handleModelChange(view.role, model)}
          onReuseGeneralChange={(reuse) => handleReuseGeneralChange(view.role, reuse)}
          onDisconnect={() => handleDisconnect(view.role)}
        />
      ))}
      <RedactionSettingsSection state={state} onChange={onStateChange} />
      {!generalBindingExists ? (
        <MessageBar messageBarType={MessageBarType.info} delayedRender={false}>
          No general LLM binding is configured yet. Connect a provider to enable semantic review and
          consistency extraction.
        </MessageBar>
      ) : null}
      {views.some((view) => !view.configured) ? (
        <section className="tf-connect-section" aria-label="Connect a provider">
          <h3 className="tf-role-title">Connect a provider</h3>
          <p className="tf-sub">
            Connect an OpenRouter account to enable the unconfigured roles above. The connection is
            bound to the first unconfigured role.
          </p>
          <OpenRouterConnectionSettings
            gatewayOrigin={gatewayOrigin}
            connection={undefined}
            catalog={null}
            models={[]}
            onCatalogChange={() => {}}
            selectedModel=""
            onSelectModel={() => {}}
            onConnectionChange={(conn) => {
              if (!conn) return;
              const unconfigured = views.find((view) => !view.configured);
              if (unconfigured) handleConnect(unconfigured.role, conn);
            }}
          />
        </section>
      ) : null}
    </div>
  );
}
