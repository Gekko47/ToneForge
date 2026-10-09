/**
 * LLM role binding operations for the settings UI.
 *
 * Pure functions that operate on `PersistedState` to resolve, validate, and
 * update role bindings. No persistence happens here — callers use `saveState`
 * from `core/state/persistence` to write the result.
 *
 * Boundary rule: this module imports only from `core/domain` and `core/state`.
 * It does not import from `ai/` or `word/`.
 */

import type { PersistedState } from "../../core/state/persistence";
import type { ProviderConnection } from "../../core/domain/ProviderConnection";
import {
  DEFAULT_ROLE_PURPOSE,
  LlmRoleBindingSchema,
  LlmRoleBindingsSchema,
  type LlmPurpose,
  type LlmRole,
  type LlmRoleBinding,
  type LlmRoleBindings,
} from "../../core/domain/LlmRole";

/**
 * Resolve the binding for a role, or undefined when the role is unbound.
 */
export function resolveRoleBinding(
  bindings: LlmRoleBindings | undefined,
  role: LlmRole,
): LlmRoleBinding | undefined {
  return bindings?.[role];
}

/**
 * The effective purpose for a role, defaulting when unspecified.
 */
export function effectivePurpose(role: LlmRole, purpose: LlmPurpose | undefined): LlmPurpose {
  return purpose ?? DEFAULT_ROLE_PURPOSE[role];
}

/**
 * Whether a purpose is valid for a role.
 *
 * - `general`: `semantic_review` or `consistency_extraction`
 * - `consistency_decision`: `consistency_decision` only
 */
export function isValidPurpose(role: LlmRole, purpose: LlmPurpose): boolean {
  if (role === "general") {
    return purpose === "semantic_review" || purpose === "consistency_extraction";
  }
  return purpose === "consistency_decision";
}

/**
 * Set or replace the binding for a role.
 *
 * Validates the binding against the schema and the role's purpose constraints.
 * When `reuseGeneral` is true on a `consistency_decision` binding, verifies that
 * a general binding exists to reuse.
 *
 * Returns the new bindings object. Does not persist.
 */
export function setRoleBinding(
  current: LlmRoleBindings | undefined,
  binding: LlmRoleBinding,
): LlmRoleBindings {
  const parsed = LlmRoleBindingSchema.parse(binding);
  if (!isValidPurpose(parsed.role, parsed.purpose ?? DEFAULT_ROLE_PURPOSE[parsed.role])) {
    throw new Error(`Purpose "${parsed.purpose}" is not valid for role "${parsed.role}"`);
  }
  if (parsed.role === "consistency_decision" && parsed.reuseGeneral) {
    const general = current?.general;
    if (!general) {
      throw new Error("Cannot reuse the general connection when no general binding is configured");
    }
  }
  const base = current ?? LlmRoleBindingsSchema.parse({});
  return { ...base, [parsed.role]: parsed };
}

/**
 * Toggle `reuseGeneral` for the consistency decision role.
 *
 * When enabling reuse, verifies that a general binding exists. When disabling,
 * simply sets the flag to false.
 *
 * Returns the new bindings object. Does not persist.
 */
export function setReuseGeneral(
  current: LlmRoleBindings | undefined,
  reuse: boolean,
): LlmRoleBindings {
  const base = current ?? LlmRoleBindingsSchema.parse({});
  const decision = base.consistency_decision;
  if (!decision) {
    throw new Error("Cannot set reuse-general when no decision binding is configured");
  }
  if (reuse && !base.general) {
    throw new Error("Cannot reuse the general connection when no general binding is configured");
  }
  return {
    ...base,
    consistency_decision: { ...decision, reuseGeneral: reuse },
  };
}

/**
 * Remove the binding for a role.
 *
 * Returns the new bindings object. Does not persist.
 */
export function removeRoleBinding(
  current: LlmRoleBindings | undefined,
  role: LlmRole,
): LlmRoleBindings {
  const base = current ?? LlmRoleBindingsSchema.parse({});
  const next = { ...base };
  delete next[role];
  return next;
}

/**
 * All connections as a record keyed by connectionId.
 *
 * Accepts the raw `providerConnections` from persisted state (which may be
 * undefined) and returns a stable empty record when absent.
 */
export function connectionsById(
  connections: PersistedState["providerConnections"],
): Readonly<Record<string, ProviderConnection>> {
  return connections ?? {};
}
