/**
 * LLM role bindings — the separation between the general LLM and the
 * consistency decision LLM.
 *
 * The general LLM performs semantic review and consistency extraction. The
 * consistency decision LLM adjudicates bounded ambiguity that the deterministic
 * engine cannot resolve. These are distinct responsibilities with distinct
 * prompts, distinct context, and distinct failure semantics, so they are bound
 * separately even when they happen to share a provider.
 *
 * A binding is a **reference** to a persisted `ProviderConnection` plus the
 * model to use for that role. It never holds a credential: the credential lives
 * in the gateway's in-memory token store, keyed by the opaque `connectionId`.
 *
 * `reuseGeneral` is the owner-sanctioned toggle: when true, the decision role
 * reuses the general connection's credential but sends a different model. This
 * works for any auth mode because the model is a per-request parameter, not a
 * property of the credential.
 *
 * Boundary rule: this module imports only `zod`. It is Office-free, AI-free,
 * and UI-free (see docs/architecture.md and ADR-0052).
 */

import { z } from "zod";

/**
 * The two LLM responsibilities the add-in distinguishes.
 *
 * - `general`: semantic review and consistency extraction.
 * - `consistency_decision`: bounded-ambiguity adjudication of structured claims.
 */
export const LlmRoleSchema = z.enum(["general", "consistency_decision"]);
export type LlmRole = z.infer<typeof LlmRoleSchema>;

/**
 * What a role is used for. Recorded on the binding for diagnostics and for
 * the troubleshooting surface; never used to switch behaviour.
 */
export const LlmPurposeSchema = z.enum([
  "semantic_review",
  "consistency_extraction",
  "consistency_decision",
]);
export type LlmPurpose = z.infer<typeof LlmPurposeSchema>;

/**
 * The default purpose for each role, used when a binding omits `purpose`.
 */
export const DEFAULT_ROLE_PURPOSE: Record<LlmRole, LlmPurpose> = {
  general: "consistency_extraction",
  consistency_decision: "consistency_decision",
};

/**
 * A binding from an LLM role to a persisted connection and model.
 *
 * `connectionId` references an entry in `PersistedState.providerConnections`
 * (keyed by connection id). `provider` is denormalized from that record so the
 * binding can be validated and rendered without a second lookup, and so a
 * stale binding (connection deleted) is detectable.
 */
export const LlmRoleBindingSchema = z.object({
  role: LlmRoleSchema,
  provider: z.enum(["openai", "anthropic", "openrouter", "mock"]),
  connectionId: z.string().trim().min(1).max(200),
  selectedModel: z.string().trim().min(1).max(200).optional(),
  purpose: LlmPurposeSchema.optional(),
  /**
   * When true, the decision role reuses the general connection's credential
   * with a different model. Only meaningful for `consistency_decision`.
   */
  reuseGeneral: z.boolean().default(false),
});
export type LlmRoleBinding = z.infer<typeof LlmRoleBindingSchema>;

/**
 * The complete set of role bindings. Each role is optional: an unbound role
 * means that responsibility has no LLM available and must report itself as
 * unconfigured rather than silently borrowing another role's connection.
 */
export const LlmRoleBindingsSchema = z.object({
  general: LlmRoleBindingSchema.optional(),
  consistency_decision: LlmRoleBindingSchema.optional(),
});
export type LlmRoleBindings = z.infer<typeof LlmRoleBindingsSchema>;

/**
 * What happens when the consistency decision LLM is unavailable.
 *
 * - `unresolved` (default): adjudicated candidates are reported as unresolved.
 *   The deterministic engine still produces its provable outcomes; the
 *   ambiguous residue is surfaced honestly.
 * - `general_model`: the general LLM is asked to adjudicate. This is a
 *   degraded mode — the general model was not prompted for adjudication — and
 *   is only offered when the general connection is independently configured.
 */
export const DecisionFallbackPolicySchema = z.enum(["unresolved", "general_model"]);
export type DecisionFallbackPolicy = z.infer<typeof DecisionFallbackPolicySchema>;

/** Empty bindings used before the user configures any role. */
export function createEmptyRoleBindings(): LlmRoleBindings {
  return LlmRoleBindingsSchema.parse({});
}

/**
 * Whether a binding references a connection that exists and is ready.
 *
 * A binding whose connection is missing, disconnected, or in a non-ready
 * status is not configured: the role has no usable LLM.
 */
export function isBindingUsable(
  binding: LlmRoleBinding | undefined,
  connections: Readonly<Record<string, { status: string }>>,
): boolean {
  if (!binding) return false;
  const connection = connections[binding.connectionId];
  if (!connection) return false;
  return connection.status === "connected";
}

/**
 * String fields on the binding that are known to be non-secret identifiers.
 *
 * `connectionId` is an opaque service-issued reference, and `selectedModel` is
 * a model identifier. Neither can hold a credential. Any OTHER string field is
 * treated as potentially secret and fails the reflection test.
 */
const KNOWN_SAFE_STRING_FIELDS = new Set(["connectionId", "selectedModel"]);

/**
 * Reflection test: the binding and fallback-policy schemas have no field
 * capable of holding a credential.
 *
 * Mirrors the `ProviderConnection` credential test. A future field that could
 * hold a secret would fail here rather than silently persisting one.
 */
export function assertRoleSchemasAreSecretFree(): void {
  const bindingShape = LlmRoleBindingSchema.shape;
  for (const key of Object.keys(bindingShape)) {
    if (KNOWN_SAFE_STRING_FIELDS.has(key)) continue;
    const value = bindingShape[key as keyof typeof bindingShape];
    if (value instanceof z.ZodString) {
      throw new Error(`LlmRoleBinding.${key} is a string and could hold a secret`);
    }
  }
  // The fallback policy is an enum of two literals; it cannot hold a secret.
  if (DecisionFallbackPolicySchema.options.length !== 2) {
    throw new Error("DecisionFallbackPolicySchema must have exactly two options");
  }
}
