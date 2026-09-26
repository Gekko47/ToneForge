import { describe, expect, it } from "vitest";
import {
  applyLlmDraft,
  isLlmDraftDirty,
  markDirty,
  markSaved,
  normalizeLlmDraft,
  toLlmDraft,
  validateBrokerBaseUrl,
  type LlmSettingsDraft,
} from "../../../../src/taskpane/settings/settingsModel";
import type { PersistedState } from "../../../../src/core/state/index";

const SETTINGS: PersistedState["settings"] = {
  llmProvider: "mock",
  openAiCredentialMode: "broker",
  spotReviewConsent: false,
  fullDocumentReviewConsent: false,
  consistencyReviewConsent: false,
  telemetryDisabled: true,
  semanticOptIn: false,
};

const DRAFT: LlmSettingsDraft = {
  openAiBaseUrl: "",
  openAiModel: "",
  llmProvider: "openai",
  spotReviewConsent: true,
  fullDocumentReviewConsent: false,
  consistencyReviewConsent: false,
  semanticOptIn: true,
};

describe("settings model", () => {
  it("projects persisted settings into a draft with empty optional text", () => {
    expect(toLlmDraft(SETTINGS)).toEqual({
      openAiBaseUrl: "",
      openAiModel: "",
      llmProvider: "mock",
      spotReviewConsent: false,
      fullDocumentReviewConsent: false,
      consistencyReviewConsent: false,
      semanticOptIn: false,
    });
  });

  it("removes blank optional fields instead of persisting empty strings", () => {
    const saved = applyLlmDraft(SETTINGS, DRAFT);
    expect(saved).not.toHaveProperty("openAiBaseUrl");
    expect(saved).not.toHaveProperty("openAiModel");
    expect(saved.llmProvider).toBe("openai");
    expect(saved.spotReviewConsent).toBe(true);
    expect(saved.semanticOptIn).toBe(true);
  });

  it("trims persisted text so an untrimmed draft is not left falsely dirty", () => {
    const padded: LlmSettingsDraft = { ...DRAFT, openAiModel: "  gpt-4o-mini  " };
    const saved = applyLlmDraft(SETTINGS, padded);
    expect(saved.openAiModel).toBe("gpt-4o-mini");
    expect(isLlmDraftDirty(normalizeLlmDraft(padded), normalizeLlmDraft(padded))).toBe(false);
    expect(isLlmDraftDirty(padded, normalizeLlmDraft(padded))).toBe(true);
  });

  it("accepts only loopback broker URLs and rejects production or credential URLs", () => {
    expect(validateBrokerBaseUrl("")).toBeNull();
    expect(validateBrokerBaseUrl("https://localhost:3000/__toneforge/llm/v1")).toBeNull();
    expect(validateBrokerBaseUrl("http://127.0.0.1:3000")).toBeNull();
    expect(validateBrokerBaseUrl("https://api.openai.com/v1")).toContain("loopback");
    expect(validateBrokerBaseUrl("not-a-url")).toContain("valid URL");
    expect(validateBrokerBaseUrl("https://user:pass@localhost:3000")).toContain("loopback");
    expect(validateBrokerBaseUrl("ftp://localhost:3000")).toContain("loopback");
    expect(validateBrokerBaseUrl("http://localhost:3000/#frag")).toContain("loopback");
  });

  it("keeps section status transitions free of stale flags", () => {
    expect(markDirty()).toEqual({ dirty: true, error: null, savedAt: null });
    const saved = markSaved();
    expect(saved.dirty).toBe(false);
    expect(saved.error).toBeNull();
    expect(typeof saved.savedAt).toBe("string");
  });
});
