/**
 * Dynamic model catalog normalization (Phase 4).
 *
 * Pure functions only: no network, no storage, no Office, no UI. A provider's
 * model list arrives as an untrusted payload and is mapped onto the
 * provider-neutral `ModelCatalog` contract through Zod.
 *
 * Shapes handled, all of which are `GET <base>/models` list responses:
 *
 * - OpenRouter: `{ data: [{ id, name, context_length, description,
 *   architecture: { input_modalities, output_modalities },
 *   supported_parameters: [...], expiration_date }] }`
 * - OpenAI:     `{ data: [{ id, ..., context_window, supported_tools }] }`
 * - Anthropic:  `{ data: [{ id, display_name, created_at }] }`
 *
 * Because the three shapes differ, normalization is deliberately defensive: a
 * field that is absent falls back to a documented default rather than making
 * the whole list unreadable. A model the provider actually offers should not be
 * hidden because one optional field is missing.
 */

import { z } from "zod";
import {
  ModelCatalogSchema,
  type ModelCatalog,
  type ModelCatalogStatus,
  type ModelDescriptor,
  type ProviderConnection,
  type ProviderId,
} from "../../core/domain/ProviderConnection";

/** Loose schema for a provider list response. Everything is optional. */
const ProviderListResponseSchema = z
  .object({
    data: z.array(z.record(z.unknown())).default([]),
  })
  .passthrough();

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

/**
 * Map one OpenRouter model entry.
 *
 * `supported_parameters` is the capability signal: OpenRouter exposes `tools`,
 * `structured_outputs`, and `reasoning` as supported parameter names rather
 * than booleans, so they are read from that list.
 */
export function normalizeOpenRouterModel(raw: Record<string, unknown>): ModelDescriptor | null {
  const id = asString(raw.id);
  if (!id) return null;
  const architecture = (raw.architecture ?? {}) as Record<string, unknown>;
  const supported = asStringArray(raw.supported_parameters);
  // `top_provider.context_length` is the limit actually enforced upstream; the
  // model-level `context_length` is the advertised one. Prefer the enforced
  // value so the UI never overstates what a request may use.
  const topProvider = (raw.top_provider ?? {}) as Record<string, unknown>;
  const contextWindow =
    asNumber(topProvider.context_length) ?? asNumber(raw.context_length) ?? null;

  return {
    id,
    displayName: asString(raw.name) ?? id,
    description: asString(raw.description) ?? "",
    contextWindow,
    inputModalities: asStringArray(architecture.input_modalities),
    outputModalities: asStringArray(architecture.output_modalities),
    supportsTools: supported.includes("tools"),
    supportsStructuredOutput:
      supported.includes("structured_outputs") || supported.includes("response_format"),
    supportsReasoning: supported.includes("reasoning") || supported.includes("include_reasoning"),
    // A model with an expiry date is on its way out; the UI should say so.
    deprecated: asString(raw.expiration_date) !== undefined,
  };
}

export function normalizeOpenAiModel(raw: Record<string, unknown>): ModelDescriptor | null {
  const id = asString(raw.id);
  if (!id) return null;
  return {
    id,
    displayName: asString(raw.name) ?? id,
    description: asString(raw.description) ?? "",
    contextWindow: asNumber(raw.context_window),
    inputModalities: asStringArray(raw.input_modalities),
    outputModalities: asStringArray(raw.output_modalities),
    supportsTools: asBoolean(raw.supported_tools),
    supportsStructuredOutput: asBoolean(raw.supports_structured_outputs),
    supportsReasoning: false,
    deprecated: asBoolean(raw.deprecated),
  };
}

export function normalizeAnthropicModel(raw: Record<string, unknown>): ModelDescriptor | null {
  const id = asString(raw.id);
  if (!id) return null;
  return {
    id,
    displayName: asString(raw.display_name) ?? id,
    description: asString(raw.description) ?? "",
    contextWindow: null,
    inputModalities: asStringArray(raw.input_modalities),
    outputModalities: asStringArray(raw.output_modalities),
    supportsTools: asBoolean(raw.supports_tools),
    supportsStructuredOutput: false,
    supportsReasoning: false,
    deprecated: false,
  };
}

const NORMALIZERS: Record<ProviderId, (raw: Record<string, unknown>) => ModelDescriptor | null> = {
  openrouter: normalizeOpenRouterModel,
  openai: normalizeOpenAiModel,
  anthropic: normalizeAnthropicModel,
  // The offline provider has a static local list supplied by the caller; it is
  // not fetched, so a payload for it is not interpreted here.
  mock: () => null,
};

export interface NormalizeCatalogOptions {
  provider: ProviderId;
  connectionId: string;
  fetchedAt: string;
  expiresAt?: string;
}

/**
 * Normalize a provider list response into a `ModelCatalog`.
 *
 * Entries that cannot yield an id are dropped rather than failing the whole
 * list, and the result is sorted by id so two fetches of the same catalog
 * produce a stable ordering for the dropdown.
 */
export function normalizeModelCatalog(
  payload: unknown,
  options: NormalizeCatalogOptions,
): ModelCatalog {
  const parsed = ProviderListResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return ModelCatalogSchema.parse({
      provider: options.provider,
      connectionId: options.connectionId,
      fetchedAt: options.fetchedAt,
      models: [],
    });
  }
  const normalize = NORMALIZERS[options.provider];
  const models = parsed.data.data
    .map((raw) => normalize(raw))
    .filter((model): model is ModelDescriptor => model !== null)
    .sort((left, right) => left.id.localeCompare(right.id));

  return ModelCatalogSchema.parse({
    provider: options.provider,
    connectionId: options.connectionId,
    fetchedAt: options.fetchedAt,
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    models,
  });
}

/**
 * Resolve the catalog's display state.
 *
 * These are distinct states on purpose: "empty" means the provider returned no
 * models, which is different from "failed", and both are different from
 * "stale", which means a previously good list must be refetched.
 */
export function resolveCatalogStatus(input: {
  loading: boolean;
  offline: boolean;
  failed: boolean;
  catalog: ModelCatalog | null;
  now: Date;
}): ModelCatalogStatus {
  if (input.loading) return "loading";
  if (input.failed) return "failed";
  if (input.offline) return "offline";
  if (!input.catalog) return "idle";
  if (
    input.catalog.expiresAt &&
    new Date(input.catalog.expiresAt).getTime() <= input.now.getTime()
  ) {
    return "stale";
  }
  return input.catalog.models.length === 0 ? "empty" : "ready";
}

/**
 * Whether a fetched catalog still belongs to the current connection.
 *
 * Changing provider must invalidate the previous provider's list, so a catalog
 * is only usable while both the provider and the connection match.
 */
export function isCatalogForConnection(
  catalog: ModelCatalog | null,
  connection: ProviderConnection,
): boolean {
  return (
    catalog !== null &&
    catalog.provider === connection.provider &&
    catalog.connectionId === connection.connectionId
  );
}

/** Drop a catalog when the selected provider changes. */
export function invalidateCatalogOnProviderChange(
  catalog: ModelCatalog | null,
  nextProvider: ProviderId,
): ModelCatalog | null {
  return catalog !== null && catalog.provider !== nextProvider ? null : catalog;
}
