/**
 * Pure dashboard model for the LLM role connections UI.
 *
 * Types and helpers that operate on `PersistedState` to build and validate
 * the role connection view. No React, no persistence — just data functions.
 */
import type { PersistedState } from "../../core/state/persistence";
import {
  DEFAULT_ROLE_PURPOSE,
  type DecisionFallbackPolicy,
  type LlmPurpose,
  type LlmRole,
  type LlmRoleBinding,
} from "../../core/domain/LlmRole";
import type { ProviderConnection } from "../../core/domain/ProviderConnection";
import { connectionsById } from "./llmRoles";

export interface RoleConnectionView {
  role: LlmRole;
  binding: LlmRoleBinding | undefined;
  connection: ProviderConnection | undefined;
  purpose: LlmPurpose;
  reuseGeneral: boolean;
  configured: boolean;
}

/**
 * Build the view state for both LLM roles from persisted state.
 *
 * Uses `connectionForRole` to resolve the effective connection, which
 * honours the `reuseGeneral` toggle on the decision role.
 */
export function buildRoleConnectionViews(state: PersistedState): RoleConnectionView[] {
  const bindings = state.llmRoleBindings;
  const connections = connectionsById(state.providerConnections);
  const roles: LlmRole[] = ["general", "consistency_decision"];
  return roles.map((role) => {
    const binding = bindings?.[role];
    const effectiveRole: LlmRole =
      role === "consistency_decision" && binding?.reuseGeneral ? "general" : role;
    const effectiveBinding = bindings?.[effectiveRole];
    const connection = effectiveBinding ? connections[effectiveBinding.connectionId] : undefined;
    const reuseGeneral = role === "consistency_decision" && binding?.reuseGeneral === true;
    return {
      role,
      binding,
      connection,
      purpose: binding?.purpose ?? DEFAULT_ROLE_PURPOSE[role],
      reuseGeneral,
      configured:
        binding !== undefined && connection !== undefined && connection.status === "connected",
    };
  });
}

export const FALLBACK_POLICY_OPTIONS: {
  key: DecisionFallbackPolicy;
  text: string;
  detail: string;
}[] = [
  {
    key: "unresolved",
    text: "Report as unresolved",
    detail:
      "Ambiguous candidates are surfaced honestly without a model verdict. " +
      "The deterministic engine still produces its provable outcomes.",
  },
  {
    key: "general_model",
    text: "Use general model",
    detail:
      "The general LLM adjudicates. Degraded — it was not prompted for adjudication, " +
      "and only available when the general connection is independently configured.",
  },
];

export function fallbackPolicyDescription(policy: DecisionFallbackPolicy): string {
  return FALLBACK_POLICY_OPTIONS.find((o) => o.key === policy)?.detail ?? "";
}

export const ROLE_LABELS: Record<LlmRole, { title: string; description: string }> = {
  general: {
    title: "General LLM",
    description:
      "Semantic review and consistency extraction. This is the primary language model connection.",
  },
  consistency_decision: {
    title: "Consistency decision LLM",
    description:
      "Adjudicates bounded ambiguity the deterministic engine cannot resolve. " +
      "May reuse the general connection with a different model.",
  },
};
