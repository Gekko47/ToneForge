import { z } from "zod";
import type { PersistedState } from "../../core/state/index";

/**
 * Pure settings contracts for the split Settings sections.
 *
 * These stay free of Office, LLM, and UI imports so they can be unit tested
 * directly: validation, normalization, and draft/baseline comparison are pure
 * data functions, and the React layer only renders their results.
 */

export const LlmSettingsDraftSchema = z.object({
  openAiBaseUrl: z.string(),
  openAiModel: z.string(),
  llmProvider: z.enum(["openai", "mock"]),
  spotReviewConsent: z.boolean(),
  fullDocumentReviewConsent: z.boolean(),
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
