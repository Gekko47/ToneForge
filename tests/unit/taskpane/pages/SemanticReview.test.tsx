/**
 * The Semantic Review page (spec §21, §22, §23, §26).
 *
 * Reassigned from the deleted `Semantic.test.tsx`, and asserting the properties
 * that page exists for rather than the ones it inherited: one live region, no
 * `FindingDetail`, nothing sent without a click, and Keep original writing
 * nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import { createRecord } from "../../../../src/core/domain/ProfileRecord";
import { hashText } from "../../../../src/shared/utils/text";
import SemanticReview from "../../../../src/taskpane/pages/SemanticReview";

const mocks = vi.hoisted(() => ({
  readSelectionScope: vi.fn(),
  reviewSemanticSelection: vi.fn(),
  applyApprovedSemanticRevision: vi.fn(),
  saveSemanticReviewOutcome: vi.fn(),
  /*
   * The watcher is mocked so these tests can decide, deliberately, whether the
   * host reports cursor movement. What it does with each answer is covered in
   * `selectionWatcher.test.ts`; what the *page* does is covered here, and the two
   * cannot be answered in the same test without a real Word host.
   */
  watchDocumentSelection: vi.fn(),
  stopWatchingDocumentSelection: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock("../../../../src/word/selectionWatcher", () => ({
  watchDocumentSelection: mocks.watchDocumentSelection,
  stopWatchingDocumentSelection: mocks.stopWatchingDocumentSelection,
}));

vi.mock("../../../../src/word/selectionScope", () => ({
  readSelectionScope: mocks.readSelectionScope,
}));

vi.mock("../../../../src/analysis/semantic/semanticReviewEngine", () => ({
  reviewSemanticSelection: mocks.reviewSemanticSelection,
}));

vi.mock("../../../../src/reformat/semanticApply", () => ({
  applyApprovedSemanticRevision: mocks.applyApprovedSemanticRevision,
}));

vi.mock("../../../../src/core/state/persistence", () => ({
  loadState: () => mocks.state as never,
  loadSemanticProfileRecord: (id: string) =>
    (mocks.state["semanticProfileRecords"] as Record<string, unknown>)[id] ?? null,
  saveSemanticReviewOutcome: mocks.saveSemanticReviewOutcome,
}));

vi.mock("../../../../src/taskpane/settings/providerComposition", () => ({
  isRemoteProviderConfigured: () => true,
  createRegistryFromSettings: () => ({ name: "test" }),
}));

const SELECTION = "The pour completed on 3 March 2026 and the cube cured for 28 days.";
const REVISED = "The pour finished on 3 March 2026 and the cube cured for 28 days.";

function anchor() {
  return {
    documentId: "doc-1",
    nodeIds: ["p-1"],
    startOffset: 0,
    endOffset: SELECTION.length,
    selectedText: SELECTION,
    selectionHash: hashText(SELECTION),
    capturedAt: "2026-10-01T09:00:00.000Z",
  };
}

function reviewResult() {
  return {
    // Real uuids: `SemanticReviewSessionSchema` requires them, and the page
    // builds its session from this result.
    reviewSessionId: "6b1d4e2a-9c33-4f8b-8a71-2d5e6f7a8b90",
    profileId: PROFILE_ID,
    profileRevision: 1,
    assessment: {
      overallAlignment: "moderate" as const,
      summary: "Two sentences carry more clauses than the profile's target.",
      observations: [
        {
          dimension: "sentenceArchitecture" as const,
          alignment: "minor_deviation" as const,
          explanation: "The second sentence runs long.",
        },
      ],
    },
    proposedRevision: REVISED,
    preservation: {
      pass: true,
      requiresAcknowledgement: false,
      originalFacts: [],
      proposedFacts: [],
      missing: [],
      added: [],
      changed: [],
      warnings: [],
      summary: "",
    },
    meaningPreservation: {
      qualificationPreserved: true,
      attributionPreserved: true,
      causationPreserved: true,
      responsibilityPreserved: true,
      certaintyPreserved: true,
    },
    actionable: true,
    providerMetadata: { provider: "test", model: "test", latencyMs: 1, attempt: 1 },
    selectionAnchor: anchor(),
  };
}

/** A real uuid: `ProfileRecordSchema` requires one, and the page reads the id back. */
const PROFILE_ID = "3f1c8f2e-6f2a-4a3f-9a5e-2f0a1b2c3d4e";

function semanticState(): Record<string, unknown> {
  const profile = createEmptyProfile("Learned semantic style", 1, "semantic");
  return {
    version: 14,
    settings: {
      llmProvider: "mock",
      openAiCredentialMode: "broker",
      autoScan: false,
      consistencyReviewConsent: false,
      semanticOptIn: true,
    },
    providerConnections: [],
    activeSemanticProfileId: PROFILE_ID,
    semanticProfileRecords: {
      [PROFILE_ID]: createRecord(
        PROFILE_ID,
        "Learned semantic style",
        "2026-10-01T09:00:00.000Z",
        profile,
        "semantic",
      ),
    },
  };
}

mocks.state = semanticState();

function renderPage(overrides: Record<string, unknown> = {}) {
  return render(
    <SemanticReview
      onBack={() => undefined}
      onOpenSettings={() => undefined}
      onOpenSemanticStyle={() => undefined}
      session={null}
      onSession={() => undefined}
      {...overrides}
    />,
  );
}

describe("the Semantic Review page", () => {
  beforeEach(() => {
    mocks.state = semanticState();
    mocks.readSelectionScope.mockReset();
    mocks.reviewSemanticSelection.mockReset();
    mocks.applyApprovedSemanticRevision.mockReset();
    mocks.saveSemanticReviewOutcome.mockReset();
    mocks.watchDocumentSelection.mockReset();
    mocks.stopWatchingDocumentSelection.mockReset();
    // Subscribed, by default. Every pre-P16 test in this file would otherwise be
    // asserting against a host with no selection event, which is the degraded
    // path and is asserted separately below.
    mocks.watchDocumentSelection.mockResolvedValue(true);
    mocks.readSelectionScope.mockResolvedValue({
      status: "ok",
      scope: {
        anchor: anchor(),
        source: "selection" as const,
        documentIdVerified: true,
        paragraphCount: 1,
        coversWholeParagraph: true,
        wordCount: 14,
        verification: "paragraph-identified",
      },
    });
    mocks.reviewSemanticSelection.mockResolvedValue(reviewResult());
  });

  it("keeps exactly one live region no matter how much has happened", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /use current selection/i }));
    await userEvent.click(screen.getByRole("button", { name: /review selection/i }));

    await waitFor(() => expect(mocks.reviewSemanticSelection).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(1);
  });

  describe("following the cursor", () => {
    it("says the text is the paragraph the cursor is in, not a selection", async () => {
      /*
       * A caret review is a decision made for the user: they clicked once to
       * place the cursor and ToneForge chose the paragraph. Saying "14 words"
       * alone would let them believe they had selected it.
       */
      mocks.readSelectionScope.mockResolvedValue({
        status: "ok",
        scope: {
          anchor: anchor(),
          source: "caret-paragraph",
          documentIdVerified: true,
          paragraphCount: 1,
          coversWholeParagraph: true,
          wordCount: 14,
          verification: "paragraph-identified",
        },
      });
      renderPage();
      await userEvent.click(screen.getByRole("button", { name: /use current selection/i }));

      expect(
        await screen.findByText(/the paragraph the cursor is in, not a selection you made/),
      ).toBeInTheDocument();
    });

    it("says it is following the cursor, so a pause is not read as a frozen pane", async () => {
      renderPage();

      expect(await screen.findByTestId("tf-semantic-tracking")).toHaveTextContent(
        /follows the cursor/i,
      );
    });

    it("says so when the host has no selection event, rather than pretending to track", async () => {
      mocks.watchDocumentSelection.mockResolvedValue(false);
      renderPage();

      expect(await screen.findByTestId("tf-semantic-tracking")).toHaveTextContent(
        /does not report cursor movement/i,
      );
      // The manual control is the fallback, so it has to still be there.
      expect(screen.getByRole("button", { name: /use current selection/i })).toBeInTheDocument();
    });

    it("stops following the cursor once a review is on screen", async () => {
      /*
       * Reading on every caret move would replace the proposal the user is reading
       * with a new one for the paragraph they clicked into, discarding work they
       * paid for. Staleness is the page's answer to "this no longer describes what
       * is on screen", so tracking is not needed to detect it.
       */
      renderPage();
      await waitFor(() => expect(mocks.watchDocumentSelection).toHaveBeenCalled());
      const onChanged = mocks.watchDocumentSelection.mock.calls[0]?.[0] as (() => void) | undefined;
      await userEvent.click(screen.getByRole("button", { name: /use current selection/i }));
      await userEvent.click(screen.getByRole("button", { name: /review selection/i }));
      await waitFor(() => expect(screen.getByText("Proposed")).toBeInTheDocument());
      const readsBefore = mocks.readSelectionScope.mock.calls.length;

      onChanged?.();

      expect(mocks.readSelectionScope).toHaveBeenCalledTimes(readsBefore);
    });

    it("unsubscribes when the page goes away", async () => {
      const { unmount } = renderPage();
      await waitFor(() => expect(mocks.watchDocumentSelection).toHaveBeenCalled());

      unmount();

      await waitFor(() => expect(mocks.stopWatchingDocumentSelection).toHaveBeenCalled());
    });
  });

  it("sends nothing to a provider until Review is pressed", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /use current selection/i }));

    // The selection card is populated, and no request has been made. The old pane
    // re-read the selection on navigation; this one does not.
    await waitFor(() => expect(screen.getByText(SELECTION)).toBeInTheDocument());
    expect(mocks.reviewSemanticSelection).not.toHaveBeenCalled();
  });

  it("renders the assessment rather than a FindingDetail", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /use current selection/i }));
    await userEvent.click(screen.getByRole("button", { name: /review selection/i }));

    await waitFor(() =>
      expect(screen.getByText(/Two sentences carry more clauses/)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/proposed semantic rewrite/i)).toBeNull();
    // The comparison is two columns of the user's own prose.
    expect(screen.getByText("Yours")).toBeInTheDocument();
    expect(screen.getByText("Proposed")).toBeInTheDocument();
  });

  it("writes nothing when Keep original is pressed", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /use current selection/i }));
    await userEvent.click(screen.getByRole("button", { name: /review selection/i }));
    await waitFor(() => expect(screen.getByText("Proposed")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /keep original/i }));

    expect(mocks.applyApprovedSemanticRevision).not.toHaveBeenCalled();
    // The decision is recorded, which is what makes "I decided against it" an
    // answer the store can give rather than a silence.
    expect(mocks.saveSemanticReviewOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "kept_original" }),
    );
  });

  it("disables Apply until the local check has passed", async () => {
    mocks.reviewSemanticSelection.mockResolvedValue({
      ...reviewResult(),
      actionable: false,
      preservation: {
        ...reviewResult().preservation,
        pass: false,
        warnings: [
          {
            kind: "date" as const,
            term: "3 March 2026",
            surface: "3 March 2026",
            tier: "hard" as const,
            direction: "removed" as const,
            message: "The proposed revision removes a date.",
          },
        ],
        summary: "ToneForge detected a factual difference in the proposed revision.",
      },
    });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /use current selection/i }));
    await userEvent.click(screen.getByRole("button", { name: /review selection/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /apply revision/i })).toBeDisabled(),
    );
    expect(screen.getByText(/cannot be applied/i)).toBeInTheDocument();
  });

  it("says why a capture is impossible rather than asking for a selection it cannot read", async () => {
    mocks.readSelectionScope.mockResolvedValue({
      status: "unavailable",
      reason: "This Word build cannot replace part of a paragraph.",
    });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /use current selection/i }));

    await waitFor(() =>
      expect(screen.getByText(/cannot replace part of a paragraph/)).toBeInTheDocument(),
    );
  });
});
