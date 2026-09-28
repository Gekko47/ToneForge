import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Semantic, { deriveSemanticAnnouncement } from "../../../../src/taskpane/pages/Semantic";
import { createRecord } from "../../../../src/core/domain/ProfileRecord";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import { sampleFinding } from "../../../fixtures/sampleDocs";

const mocks = vi.hoisted(() => ({
  getDocumentSnapshot: vi.fn(),
  getSelectionText: vi.fn(),
  getStructuredSnapshot: vi.fn(),
  loadState: vi.fn(),
  loadSemanticProfileRecord: vi.fn(),
  createSemanticProfileRecord: vi.fn(),
  saveSemanticProfileRecord: vi.fn(),
  learnStyleDraft: vi.fn(),
  proposeSemanticRewrite: vi.fn(),
}));

vi.mock("../../../../src/word/documentReader", () => ({
  getDocumentSnapshot: mocks.getDocumentSnapshot,
  getSelectionText: mocks.getSelectionText,
  getStructuredSnapshot: mocks.getStructuredSnapshot,
}));

vi.mock("../../../../src/core/state/persistence", () => ({
  loadState: mocks.loadState,
  loadSemanticProfileRecord: mocks.loadSemanticProfileRecord,
  createSemanticProfileRecord: mocks.createSemanticProfileRecord,
  saveSemanticProfileRecord: mocks.saveSemanticProfileRecord,
}));

vi.mock("../../../../src/style/learnStyle", () => ({
  learnStyleDraft: mocks.learnStyleDraft,
}));

vi.mock("../../../../src/analysis/rewriteEngine", () => ({
  proposeSemanticRewrite: mocks.proposeSemanticRewrite,
}));

function semanticState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activeSemanticProfileId: "rec-1",
    providerConnections: {},
    settings: {
      semanticOptIn: true,
      llmProvider: "openai",
      openAiBaseUrl: "https://api.example.com",
      ...overrides,
    },
  };
}

/** A semantic record with a real draft, built from the unmocked domain module. */
function record(): ReturnType<typeof createRecord> {
  return createRecord(
    "3f1b0c6e-6a54-4b1e-9c2a-0d1e2f3a4b5c",
    "Learned semantic style",
    "2026-01-01T00:00:00.000Z",
    createEmptyProfile("Learned semantic style"),
    "semantic",
  );
}

beforeEach(() => {
  mocks.getDocumentSnapshot.mockResolvedValue({
    id: "doc-1",
    text: "Some document text that is long enough to be a usable sample for learning.",
    analysisText:
      "Some document text that is long enough to be a usable sample for learning. It has a second sentence as well.",
    capturedAt: "2026-01-01T00:00:00.000Z",
  });
  mocks.getSelectionText.mockResolvedValue("");
  mocks.getStructuredSnapshot.mockResolvedValue({ nodes: [] });
  mocks.loadState.mockReturnValue(semanticState());
  mocks.loadSemanticProfileRecord.mockReturnValue(record());
  mocks.createSemanticProfileRecord.mockReturnValue(record());
  mocks.saveSemanticProfileRecord.mockImplementation(() => undefined);
  mocks.proposeSemanticRewrite.mockResolvedValue(sampleFinding({ actionable: true }));
  mocks.learnStyleDraft.mockResolvedValue({
    draft: { name: "Learned semantic style" },
    evidence: { source: "document", wordCount: 14 },
  });
});

function renderPage(overrides: Partial<React.ComponentProps<typeof Semantic>> = {}) {
  const props = {
    onBack: vi.fn(),
    onOpenSettings: vi.fn(),
    onSendToPendingChanges: vi.fn(),
    ...overrides,
  };
  return { ...render(<Semantic {...props} />), props };
}

describe("the Semantic announcement", () => {
  it("speaks an error in preference to a success", () => {
    // A learn finishing while a rewrite error is still on screen must not let
    // the quieter success win.
    const result = deriveSemanticAnnouncement({
      learnStatus: "Learned from document sample.",
      learnError: null,
      rewriteError: "The provider refused the request.",
      selection: "some text",
    });
    expect(result).toEqual({ text: "The provider refused the request.", assertive: true });
  });

  it("falls back to the success once there is no error", () => {
    const result = deriveSemanticAnnouncement({
      learnStatus: "Learned from document sample.",
      learnError: null,
      rewriteError: null,
      selection: "some text",
    });
    expect(result).toEqual({ text: "Learned from document sample.", assertive: false });
  });

  it("says nothing at all when nothing has happened", () => {
    // Announcing on mount would be the pane talking over the user's first
    // action of the session.
    const result = deriveSemanticAnnouncement({
      learnStatus: null,
      learnError: null,
      rewriteError: null,
      selection: null,
    });
    expect(result).toBeNull();
  });
});

describe("the Semantic tab", () => {
  it("keeps exactly one live region no matter how much has happened", async () => {
    /*
     * The one-live-region rule (ADR-0062). Learn and rewrite each have a success
     * and a failure; rendering one region per source let two update in the same
     * tick and a screen reader read them in DOM order rather than event order.
     */
    const { container } = renderPage();
    expect(container.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: /learn from current document/i }));
    await waitFor(() => expect(mocks.learnStyleDraft).toHaveBeenCalled());
    expect(container.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(1);
  });

  it("does not let missing consent lock the user out of editing their own profile", () => {
    /*
     * Consent governs sending text to a provider. Typing a tone into a local
     * field sends nothing, so disabling the editor here locked out exactly the
     * user who had declined.
     */
    mocks.loadState.mockReturnValue(
      semanticState({ semanticOptIn: false, llmProvider: "mock", openAiBaseUrl: null }),
    );
    renderPage();

    expect(screen.getByLabelText("Tone")).not.toBeDisabled();
  });

  it("states a missing measurement as absent rather than as zero", () => {
    // A profile learned from too short a sample has no value. Printing 0 reads
    // as a real measurement, which is a different claim.
    const rec = record();
    const draft = rec.draft;
    if (draft === null) throw new Error("a created record always has a draft");
    mocks.loadSemanticProfileRecord.mockReturnValue({
      ...rec,
      draft: {
        ...draft,
        measured: { ...draft.measured, avgSentenceLength: null, sampleWordCount: null },
      },
    });
    renderPage();

    const terms = screen.getAllByText("not measured yet");
    expect(terms.length).toBeGreaterThan(0);
  });

  it("does not send the sample to a provider without consent", async () => {
    mocks.loadState.mockReturnValue(
      semanticState({ semanticOptIn: false, llmProvider: "mock", openAiBaseUrl: null }),
    );
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /learn from current document/i }));
    await waitFor(() => expect(mocks.learnStyleDraft).toHaveBeenCalled());

    // The draft is still learned, deterministically — only the interpretation
    // is withheld.
    expect(mocks.learnStyleDraft.mock.calls[0]?.[1]).toMatchObject({ includeSemantic: false });
  });

  it("refuses to read a selection when consent is missing", () => {
    mocks.loadState.mockReturnValue(
      semanticState({ semanticOptIn: false, llmProvider: "mock", openAiBaseUrl: null }),
    );
    renderPage();

    expect(screen.getByRole("button", { name: /read current selection/i })).toBeDisabled();
  });

  it("hands the proposal to the review gate rather than writing it", async () => {
    const { props } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: /read current selection/i }));
    mocks.getSelectionText.mockResolvedValue("A sentence worth rewriting.");
    await userEvent.click(screen.getByRole("button", { name: /read current selection/i }));
    await userEvent.click(screen.getByRole("button", { name: /propose rewrite/i }));
    await waitFor(() => expect(mocks.proposeSemanticRewrite).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("button", { name: /review in document governance/i }));
    expect(props.onSendToPendingChanges).toHaveBeenCalledTimes(1);
  });

  it("refuses the hand-off when the engine could not resolve the anchor", async () => {
    // `proposeSemanticRewrite` returns an advisory finding rather than throwing
    // when the anchor cannot be located. Sending that to the review gate would
    // offer a change the engine already knows it cannot place.
    mocks.proposeSemanticRewrite.mockResolvedValue(
      sampleFinding({ actionable: false, advisoryReason: "The anchor could not be located." }),
    );
    renderPage();

    mocks.getSelectionText.mockResolvedValue("A sentence worth rewriting.");
    await userEvent.click(screen.getByRole("button", { name: /read current selection/i }));
    await userEvent.click(screen.getByRole("button", { name: /propose rewrite/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /review in document governance/i })).toBeDisabled(),
    );
  });

  it("says the proposal changed nothing in the document", async () => {
    // The single most misleading thing this card could claim is that a rewrite
    // has been applied. It has not; it is a proposal.
    mocks.getSelectionText.mockResolvedValue("A sentence worth rewriting.");
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /read current selection/i }));
    await userEvent.click(screen.getByRole("button", { name: /propose rewrite/i }));

    await waitFor(() =>
      expect(screen.getByText(/nothing has been changed in the document/i)).toBeInTheDocument(),
    );
  });

  it("reports a rewrite failure in the one live region", async () => {
    mocks.getSelectionText.mockResolvedValue("A sentence worth rewriting.");
    mocks.proposeSemanticRewrite.mockRejectedValue(new Error("The provider is unavailable."));
    const { container } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: /read current selection/i }));
    await userEvent.click(screen.getByRole("button", { name: /propose rewrite/i }));

    await waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "The provider is unavailable.",
      ),
    );
  });

  it("offers the settings link when no provider is configured", async () => {
    mocks.loadState.mockReturnValue(
      semanticState({ semanticOptIn: true, llmProvider: "mock", openAiBaseUrl: null }),
    );
    const { props } = renderPage();

    expect(screen.getByText(/no ai provider is configured/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /open settings/i }));
    expect(props.onOpenSettings).toHaveBeenCalled();
  });
});
