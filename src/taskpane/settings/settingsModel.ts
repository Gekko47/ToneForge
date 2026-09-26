import { z } from "zod";
import type { PersistedState } from "../../core/state/index";

/**
 * Pure settings contracts for the split Settings sections.
 *
 * These stay free of Office, LLM, and UI imports so they can be unit tested
 * directly: validation, normalization, and draft/baseline comparison are pure
 * data functions, and the React layer only renders their results.
 */

import type { ModelCatalog, ModelDescriptor, ProviderId } from "../../core/domain/index";

/**
 * The OpenRouter API base the add-in is configured to use.
 *
 * The add-in never calls this origin directly: the key is submitted to the
 * gateway, which is the component that talks to OpenRouter. The value is shown
 * and prefilled so the user can see and, if their account requires it, point at
 * a different OpenRouter-compatible endpoint without hunting for it.
 */
export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export interface ProviderOption {
  key: ProviderId;
  text: string;
  /** How the credential reaches the provider, stated plainly for the user. */
  authNote: string;
}

export const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    key: "mock",
    text: "Mock (offline)",
    authNote: "No network call. ToneForge answers from its built-in offline stub.",
  },
  {
    key: "openai",
    text: "OpenAI",
    authNote: "Deployment-managed. The gateway holds the credential; the add-in never sees it.",
  },
  {
    key: "anthropic",
    text: "Anthropic",
    authNote: "Deployment-managed. The gateway holds the credential; the add-in never sees it.",
  },
  {
    key: "openrouter",
    text: "OpenRouter",
    authNote:
      "You supply an API key. It is sent once to the gateway over the same-origin loopback channel and is not stored in ToneForge, in the browser, or in the bundle.",
  },
];

export function providerOption(provider: ProviderId): ProviderOption {
  return (
    PROVIDER_OPTIONS.find((option) => option.key === provider) ??
    // The offline stub is the fail-closed default: an unknown provider must
    // never be described as though it were a usable remote one.
    (PROVIDER_OPTIONS[0] as ProviderOption)
  );
}

/** Only OpenRouter takes a user-held key, so only OpenRouter shows a key field. */
export function providerAcceptsUserApiKey(provider: ProviderId): boolean {
  return provider === "openrouter";
}

/**
 * Why the consistency consent is a separate control, in the user's own terms.
 *
 * Kept beside the model rather than only in documentation so the reason travels
 * with the thing it justifies. Someone reading Settings and nothing else should
 * still be able to see why this toggle is not covered by the two above it.
 */
export const CONSISTENCY_CONSENT_EXPLANATION =
  "Cross-report consistency review compares the whole document against itself using a language model. " +
  "It is a separate check, it always covers the whole document, and it is not covered by the permissions above.";

export const LlmSettingsDraftSchema = z.object({
  openAiBaseUrl: z.string(),
  openAiModel: z.string(),
  llmProvider: z.enum(["openai", "anthropic", "openrouter", "mock"]),
  spotReviewConsent: z.boolean(),
  fullDocumentReviewConsent: z.boolean(),
  consistencyReviewConsent: z.boolean(),
  semanticOptIn: z.boolean(),
});

export type LlmSettingsDraft = z.infer<typeof LlmSettingsDraftSchema>;

export const INITIAL_SECTION_STATUS: SectionStatus = {
  dirty: false,
  error: null,
  savedAt: null,
};

export interface SectionStatus {
  dirty: boolean;
  error: string | null;
  savedAt: string | null;
}

export function toLlmDraft(settings: PersistedState["settings"]): LlmSettingsDraft {
  return {
    openAiBaseUrl: settings.openAiBaseUrl ?? "",
    openAiModel: settings.openAiModel ?? "",
    llmProvider: settings.llmProvider,
    spotReviewConsent: settings.spotReviewConsent,
    fullDocumentReviewConsent: settings.fullDocumentReviewConsent,
    consistencyReviewConsent: settings.consistencyReviewConsent,
    semanticOptIn: settings.semanticOptIn,
  };
}

/** Trim persisted text so an untrimmed input never leaves a section falsely dirty. */
export function normalizeLlmDraft(draft: LlmSettingsDraft): LlmSettingsDraft {
  return {
    ...draft,
    openAiBaseUrl: draft.openAiBaseUrl.trim(),
    openAiModel: draft.openAiModel.trim(),
  };
}

export function isLlmDraftDirty(draft: LlmSettingsDraft, baseline: LlmSettingsDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(baseline);
}

/**
 * Validate the OpenRouter API base the gateway will call upstream.
 *
 * Unlike the broker URL, this one is a public remote endpoint, so the rule is
 * HTTPS-only rather than loopback-only. Credentials, fragments, and query
 * strings are still refused: a key pasted into a URL would otherwise end up in
 * the request line, in proxy logs, and in browser history.
 */
export function validateOpenRouterBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "OpenRouter base URL is required.";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "OpenRouter base URL is not a valid URL.";
  }
  if (url.protocol !== "https:") {
    return "OpenRouter base URL must use HTTPS.";
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "" || url.search !== "") {
    return "OpenRouter base URL must not contain credentials, a query, or a fragment.";
  }
  return null;
}

/**
 * A minimal shape check on a submitted key.
 *
 * This never inspects the value beyond length and whitespace: the point is to
 * catch an obvious paste mistake before it crosses the network, not to
 * second-guess a credential that only the provider can validate.
 */
export function validateApiKeyInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "An API key is required.";
  if (/\s/.test(trimmed)) return "An API key must not contain whitespace.";
  if (trimmed.length < 16) return "That does not look like a complete API key.";
  return null;
}

/** A model the user may actually pick, given the current connection. */
export interface ModelDropdownOption {
  key: string;
  text: string;
  /** Shown next to the model so a user can judge the trade-off. */
  detail: string;
}

/**
 * Turn a fetched catalog into dropdown options.
 *
 * A deprecated model stays visible but is labelled and sorted last: silently
 * hiding a model a user's existing configuration names would make their saved
 * selection appear to have vanished.
 */
export function buildModelOptions(models: ModelDescriptor[]): ModelDropdownOption[] {
  return [...models]
    .sort((left, right) => {
      if (left.deprecated !== right.deprecated) return left.deprecated ? 1 : -1;
      return left.id.localeCompare(right.id);
    })
    .map((model) => {
      const context = model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k ctx` : "";
      const flags = [
        model.supportsTools ? "tools" : null,
        model.supportsStructuredOutput ? "structured" : null,
        model.supportsReasoning ? "reasoning" : null,
      ].filter((flag): flag is string => flag !== null);
      return {
        key: model.id,
        text: model.deprecated ? `${model.displayName} (deprecated)` : model.displayName,
        detail: [model.id, context, ...flags].filter((part) => part.length > 0).join(" · "),
      };
    });
}

/** Whether a model id is one the provider currently offers. */
export function isSelectableModel(
  catalog: ModelCatalog | null,
  modelId: string,
  options: ModelDropdownOption[],
): boolean {
  if (catalog === null) return false;
  return options.some((option) => option.key === modelId);
}

/**
 * The broker base URL is a local development endpoint. It must be an HTTP(S)
 * loopback URL with no embedded credentials and no fragment, so a production
 * URL or a credential-bearing URL can never be persisted by accident.
 */
export function validateBrokerBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "Broker base URL is not a valid URL.";
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  const schemeOk = url.protocol === "http:" || url.protocol === "https:";
  if (!loopback || !schemeOk || url.username !== "" || url.password !== "" || url.hash !== "") {
    return "Broker base URL must be an HTTP(S) loopback URL without credentials or a fragment.";
  }
  return null;
}

/**
 * Produce the next persisted settings for a saved LLM draft. Empty optional
 * fields are removed rather than persisted as blank strings.
 */
export function applyLlmDraft(
  current: PersistedState["settings"],
  draft: LlmSettingsDraft,
): PersistedState["settings"] {
  const normalized = normalizeLlmDraft(draft);
  const next: PersistedState["settings"] = {
    ...current,
    llmProvider: normalized.llmProvider,
    spotReviewConsent: normalized.spotReviewConsent,
    fullDocumentReviewConsent: normalized.fullDocumentReviewConsent,
    consistencyReviewConsent: normalized.consistencyReviewConsent,
    semanticOptIn: normalized.semanticOptIn,
  };
  if (normalized.openAiBaseUrl) next.openAiBaseUrl = normalized.openAiBaseUrl;
  else delete next.openAiBaseUrl;
  if (normalized.openAiModel) next.openAiModel = normalized.openAiModel;
  else delete next.openAiModel;
  return next;
}

export function markDirty(): SectionStatus {
  return { dirty: true, error: null, savedAt: null };
}

export function markSaved(): SectionStatus {
  return { dirty: false, error: null, savedAt: new Date().toISOString() };
}

export function markError(current: SectionStatus, error: string): SectionStatus {
  return { ...current, error };
}
