/**
 * The Semantic Style page.
 *
 * Reassigned from the deleted `Semantic.test.tsx`. What it pins is the split's
 * whole claim: this page is about the style, it sends nothing while you edit, and
 * it does not lock a user out of their own profile for declining AI consent.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import { createRecord } from "../../../../src/core/domain/ProfileRecord";
import SemanticStyle from "../../../../src/taskpane/pages/SemanticStyle";

const mocks = vi.hoisted(() => ({
  learnStyleDraft: vi.fn(),
  saveSemanticProfileRecord: vi.fn(),
  createSemanticProfileRecord: vi.fn(),
  syncSemanticRibbon: vi.fn(),
  setActiveSemanticProfile: vi.fn(),
  isRemoteProviderConfigured: vi.fn(() => true),
  getDocumentSnapshot: vi.fn(),
  getSelectionText: vi.fn(async () => ""),
  state: {} as Record<string, unknown>,
}));

vi.mock("../../../../src/style/learnStyle", () => ({
  learnStyleDraft: mocks.learnStyleDraft,
}));

vi.mock("../../../../src/core/state/persistence", () => ({
  loadState: () => mocks.state as never,
  loadSemanticProfileRecord: (id: string) =>
    (mocks.state["semanticProfileRecords"] as Record<string, unknown>)[id] ?? null,
  saveSemanticProfileRecord: mocks.saveSemanticProfileRecord,
  createSemanticProfileRecord: mocks.createSemanticProfileRecord,
  setActiveSemanticProfile: mocks.setActiveSemanticProfile,
  removeSemanticProfile: vi.fn(),
}));

vi.mock("../../../../src/commands/ribbonState", () => ({
  syncSemanticRibbon: mocks.syncSemanticRibbon,
}));

vi.mock("../../../../src/word/documentReader", () => ({
  getDocumentSnapshot: mocks.getDocumentSnapshot,
  getSelectionText: mocks.getSelectionText,
}));

vi.mock("../../../../src/taskpane/settings/providerComposition", () => ({
  isRemoteProviderConfigured: mocks.isRemoteProviderConfigured,
  createRegistryFromSettings: () => ({ name: "test" }),
}));

const PROFILE_ID = "3f1c8f2e-6f2a-4a3f-9a5e-2f0a1b2c3d4e";

function semanticState(semanticOptIn = true): Record<string, unknown> {
  return {
    version: 14,
    settings: {
      llmProvider: "mock",
      openAiCredentialMode: "broker",
      autoScan: false,
      consistencyReviewConsent: false,
      semanticOptIn,
    },
    providerConnections: [],
    activeSemanticProfileId: PROFILE_ID,
    semanticProfileRecords: {
      [PROFILE_ID]: createRecord(
        PROFILE_ID,
        "Learned semantic style",
        "2026-10-01T09:00:00.000Z",
        createEmptyProfile("Learned semantic style", 1, "semantic"),
        "semantic",
      ),
    },
  };
}

function renderPage() {
  return render(<SemanticStyle onBack={() => undefined} onOpenSettings={() => undefined} />);
}

describe("the Semantic Style page", () => {
  beforeEach(() => {
    mocks.state = semanticState();
    mocks.learnStyleDraft.mockReset();
    mocks.saveSemanticProfileRecord.mockReset();
    mocks.syncSemanticRibbon.mockReset();
    mocks.isRemoteProviderConfigured.mockReturnValue(true);
  });

  it("shows every measured metric, not a selection of them", () => {
    renderPage();

    // The deterministic editor rendered all eight; the Semantic tab rendered
    // four. Moving the block without the other four would have deleted them from
    // the interface while the engine kept using them.
    [
      "Average sentence length",
      "Sentence length spread",
      "Average paragraph length",
      "Em dash frequency",
      "En dash frequency",
      "Curly quote frequency",
      "Capitalization consistency",
      "Sample size",
    ].forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
  });

  it("states a missing measurement as absent rather than as zero", () => {
    renderPage();

    // A profile learned from too short a sample has no value here, and printing
    // "0" would be a different claim.
    expect(screen.getAllByText("not measured yet").length).toBeGreaterThan(0);
  });

  it("does not let missing consent lock the user out of editing their own style", () => {
    mocks.state = semanticState(false);
    renderPage();

    // Consent governs sending prose to a provider; typing a tone sends nothing.
    // Conflating them locks out exactly the user who declined.
    expect(screen.getByRole("heading", { name: /measured style/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /no semantic profile is active/i })).toBeNull();
  });

  it("explains why learning is blocked when consent is missing", () => {
    mocks.state = semanticState(false);
    renderPage();

    expect(screen.getByText(/needs its own consent in Settings/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /learn from pasted text/i })).toBeDisabled();
  });

  it("learns from the pasted box without reading the document", async () => {
    mocks.learnStyleDraft.mockResolvedValue({
      draft: createEmptyProfile("Learned semantic style", 1, "semantic"),
      evidence: {
        source: "pasted_text",
        wordCount: 12,
        sentenceCount: 2,
        paragraphCount: 1,
        capturedAt: "2026-10-01T09:00:00.000Z",
        sampleHash: "abc",
      },
    });
    mocks.createSemanticProfileRecord.mockReturnValue(
      createRecord(PROFILE_ID, "Learned semantic style", "2026-10-01T09:00:00.000Z"),
    );
    renderPage();

    await userEvent.type(
      screen.getByLabelText(/paste a sample of your writing/i),
      "A short paragraph.",
    );
    await userEvent.click(screen.getByRole("button", { name: /learn from pasted text/i }));

    await waitFor(() => expect(mocks.learnStyleDraft).toHaveBeenCalledTimes(1));
    expect(mocks.getDocumentSnapshot).not.toHaveBeenCalled();
    expect(mocks.getSelectionText).not.toHaveBeenCalled();
    expect(mocks.learnStyleDraft.mock.calls[0]![0]).toMatchObject({ source: "pasted_text" });
  });

  it("cannot fire with an empty box, rather than reporting a bad sample", async () => {
    renderPage();

    expect(screen.getByRole("button", { name: /learn from pasted text/i })).toBeDisabled();
    expect(mocks.learnStyleDraft).not.toHaveBeenCalled();
  });

  it("keeps exactly one live region", () => {
    renderPage();

    expect(document.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(1);
  });
});
