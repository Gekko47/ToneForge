import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Semantic, { deriveSemanticAnnouncement } from "../../../../src/taskpane/pages/Semantic";
import { createRecord } from "../../../../src/core/domain/ProfileRecord";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import { sampleFinding } from "../../../fixtures/sampleDocs";

const mocks = vi.hoisted(() => ({
  syncRibbon: vi.fn(),
  getDocumentSnapshot: vi.fn(),
  getSelectionText: vi.fn(),
  getStructuredSnapshot: vi.fn(),
  loadState: vi.fn(),
  loadSemanticProfileRecord: vi.fn(),
  createSemanticProfileRecord: vi.fn(),
  saveSemanticProfileRecord: vi.fn(),
  setActiveSemanticProfile: vi.fn(),
  removeSemanticProfile: vi.fn(),
  learnStyleDraft: vi.fn(),
  proposeSemanticRewrite: vi.fn(),
  applySemanticRewrite: vi.fn(),
}));

vi.mock("../../../../src/reformat/semanticApply", () => ({
  applySemanticRewrite: mocks.applySemanticRewrite,
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
  setActiveSemanticProfile: mocks.setActiveSemanticProfile,
  removeSemanticProfile: mocks.removeSemanticProfile,
}));

vi.mock("../../../../src/style/learnStyle", () => ({
  learnStyleDraft: mocks.learnStyleDraft,
}));

vi.mock("../../../../src/analysis/rewriteEngine", () => ({
  proposeSemanticRewrite: mocks.proposeSemanticRewrite,
}));

vi.mock("../../../../src/commands/ribbonState", () => ({
  syncSemanticRibbon: mocks.syncRibbon,
}));

/** Local alias, so the assertions read as the call they are checking. */
const syncRibbon = mocks.syncRibbon;

/** The ids the real records carry, so state keys and record ids cannot diverge. */
const FIRST_ID = "3f1b0c6e-6a54-4b1e-9c2a-0d1e2f3a4b5c";
const SECOND_ID = "9a2c7d11-3f0b-4c8e-9a44-5b6c7d8e9f01";

function semanticState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activeSemanticProfileId: FIRST_ID,
    /*
     * The picker reads the real `selectKindRecordList`, so the fixture has to
     * hold actual records rather than just an active id.
     */
    semanticProfileRecords: { [FIRST_ID]: record() },
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

/** A second profile, so switching is not a switch to the only one there is. */
function secondRecord(): ReturnType<typeof createRecord> {
  return createRecord(
    SECOND_ID,
    "Second voice",
    "2026-01-02T00:00:00.000Z",
    createEmptyProfile("Second voice"),
    "semantic",
  );
}

/** State holding both profiles, with the first one active. */
function twoProfileState(): Record<string, unknown> {
  return {
    ...semanticState(),
    semanticProfileRecords: { [FIRST_ID]: record(), [SECOND_ID]: secondRecord() },
  };
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
  /*
   * Id-aware, so switching profiles actually loads the other one. A mock that
   * returned the same record for every id would let the page pass while holding
   * the previous voice — the exact bug the `activeId` state exists to prevent.
   */
  mocks.loadSemanticProfileRecord.mockImplementation((id: string) =>
    id === SECOND_ID ? secondRecord() : record(),
  );
  mocks.createSemanticProfileRecord.mockReturnValue(secondRecord());
  mocks.saveSemanticProfileRecord.mockImplementation(() => undefined);
  mocks.setActiveSemanticProfile.mockImplementation(() => undefined);
  mocks.removeSemanticProfile.mockImplementation(() => undefined);
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
    ...overrides,
  };
  return { ...render(<Semantic {...props} />), props };
}

/**
 * The semantic tab owns the semantic profile: its settings, and the measured
 * context that gives those settings something to be judged against.
 *
 * The deterministic profile editor used to render both, read-only, which made
 * the deterministic tab look like it owned a semantic profile it could not
 * edit. Removing those blocks is only half the fix: the deterministic tab
 * showed all eight measured metrics and this one showed four, so a move that
 * did not also move the other four would have deleted em dash, en dash and
 * curly quote frequency and capitalization consistency from the interface
 * altogether — numbers the engine still used and nobody could see.
 */
describe("the semantic profile surface", () => {
  it("shows every measured metric, not a selection of them", async () => {
    const learned = createRecord(
      FIRST_ID,
      "Learned semantic style",
      "2026-01-01T00:00:00.000Z",
      {
        ...createEmptyProfile("Learned semantic style"),
        measured: {
          avgSentenceLength: 18.4,
          sentenceLengthStdDev: 5.2,
          emDashFrequency: 3.1,
          enDashFrequency: 1.4,
          curlyQuoteFrequency: 22.7,
          paragraphLengthAvg: 61.3,
          // A proportion of 0 to 1, as `computeMeasuredProfile` produces it —
          // not 96.5. The formatter divides by nothing and multiplies by 100.
          capitalizationConsistency: 0.965,
          sampleWordCount: 4820,
        },
      },
      "semantic",
    );
    mocks.loadState.mockReturnValue({
      ...semanticState(),
      semanticProfileRecords: { [FIRST_ID]: learned },
    });
    mocks.loadSemanticProfileRecord.mockReturnValue(learned);

    renderPage();

    const measured = await screen.findByRole("heading", { name: "Measured style" });
    const list = measured.closest("section") as HTMLElement;
    [
      "Average sentence length",
      "Sentence length spread",
      "Average paragraph length",
      "Em dash frequency",
      "En dash frequency",
      "Curly quote frequency",
      "Capitalization consistency",
      "Sample size",
    ].forEach((label) => {
      expect(within(list).getByText(label)).toBeInTheDocument();
    });
    // The four that were only ever on the deterministic tab, with real values,
    // so a regression to "not measured yet" is visible as a failure here.
    expect(within(list).getByText("3.1 per 100 words")).toBeInTheDocument();
    // Stored as a proportion of 0 to 1, so 0.965 has to render as 97% rather
    // than being rounded as though it were already a percentage.
    expect(within(list).getByText("97%")).toBeInTheDocument();
  });

  it("saves an edited semantic value to the semantic record", async () => {
    const user = userEvent.setup();
    renderPage();

    const tone = await screen.findByLabelText("Tone");
    await user.clear(tone);
    await user.type(tone, "Measured");
    await user.tab();

    await waitFor(() => expect(mocks.saveSemanticProfileRecord).toHaveBeenCalled());
    const saved = mocks.saveSemanticProfileRecord.mock.calls.at(-1)?.[0];
    // Through the semantic writer. A write to the deterministic record under
    // the same id would leave the two namespaces silently divergent: the
    // rewrite would reason about a voice the editor no longer shows.
    expect(saved?.kind).toBe("semantic");
    expect(saved?.draft?.semantic.tone).toBe("Measured");
  });

  it("hands the rewrite the profile it just edited", async () => {
    const user = userEvent.setup();
    mocks.getSelectionText.mockResolvedValue("Some selected words.");
    mocks.proposeSemanticRewrite.mockResolvedValue(sampleFinding({ actionable: true }));
    renderPage();

    const tone = await screen.findByLabelText("Tone");
    await user.clear(tone);
    await user.type(tone, "Clipped");
    await user.tab();

    await user.click(await screen.findByRole("button", { name: "Read current selection" }));
    await user.click(await screen.findByRole("button", { name: "Propose rewrite" }));

    await waitFor(() => expect(mocks.proposeSemanticRewrite).toHaveBeenCalled());
    // `proposeSemanticRewrite(selection, profile, options, nodes)`: the profile
    // is the second argument.
    const [, profile] = mocks.proposeSemanticRewrite.mock.calls.at(-1) ?? [];
    // The engine reasons about this profile, so the edit has to be in it.
    expect(profile?.semantic.tone).toBe("Clipped");
  });
});

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

  /*
   * The dead end this replaces.
   *
   * The tab used to hand the proposal to the deterministic review gate, which
   * resolves a finding against a deterministic plan. A semantic proposal is not
   * in one, so the gate refused every rewrite with "the planner proposes no
   * correction for this finding" — the user got a paragraph they could neither
   * apply nor refine. The two decisions the tab can actually offer are made on
   * the tab.
   */
  it("offers apply and regenerate on the tab, with no hand-off to the review gate", async () => {
    renderPage();
    mocks.getSelectionText.mockResolvedValue("A sentence worth rewriting.");
    await userEvent.click(screen.getByRole("button", { name: /read current selection/i }));
    await userEvent.click(screen.getByRole("button", { name: /propose rewrite/i }));

    expect(await screen.findByRole("button", { name: "Apply revision" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /regenerate review/i })).toBeEnabled();
    // The old hand-off, by its old label. Matched precisely rather than on
    // "Deterministic Review", which is also the breadcrumb above it.
    expect(screen.queryByRole("button", { name: /review on deterministic review/i })).toBeNull();
  });

  it("shows the original and the proposal side by side", async () => {
    renderPage();
    mocks.getSelectionText.mockResolvedValue("A sentence worth rewriting.");
    await userEvent.click(screen.getByRole("button", { name: /read current selection/i }));
    await userEvent.click(screen.getByRole("button", { name: /propose rewrite/i }));

    const comparison = (
      await screen.findByRole("heading", { name: /your paragraph and the proposed revision/i })
    ).closest("section") as HTMLElement;
    expect(within(comparison).getByText("Yours")).toBeInTheDocument();
    expect(within(comparison).getByText("Proposed")).toBeInTheDocument();
  });

  it("writes the revision through the semantic apply path", async () => {
    renderPage();
    mocks.getSelectionText.mockResolvedValue("A sentence worth rewriting.");
    mocks.getStructuredSnapshot.mockResolvedValue({
      documentId: "doc-1",
      contentHash: "hash-now",
      nodes: [],
    });
    mocks.applySemanticRewrite.mockResolvedValue({
      applied: true,
      verified: true,
      stale: false,
      results: [],
      tracking: { managed: true },
      plan: { changes: [] },
      refusal: null,
    });
    await userEvent.click(screen.getByRole("button", { name: /read current selection/i }));
    await userEvent.click(screen.getByRole("button", { name: /propose rewrite/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Apply revision" }));

    await waitFor(() => expect(mocks.applySemanticRewrite).toHaveBeenCalledTimes(1));
    // Re-read the document at apply time rather than reusing the hash from when
    // the model was asked: the two are separated by however long the user spent
    // reading the result.
    expect(mocks.applySemanticRewrite.mock.calls.at(-1)?.[0]).toMatchObject({
      documentId: "doc-1",
      currentDocHash: "hash-now",
    });
    expect(await screen.findByText(/written as a tracked change/i)).toBeInTheDocument();
  });

  it("asks again with the same paragraph when regenerate is pressed", async () => {
    renderPage();
    mocks.getSelectionText.mockResolvedValue("A sentence worth rewriting.");
    await userEvent.click(screen.getByRole("button", { name: /read current selection/i }));
    await userEvent.click(screen.getByRole("button", { name: /propose rewrite/i }));
    await waitFor(() => expect(mocks.proposeSemanticRewrite).toHaveBeenCalledTimes(1));
    await userEvent.click(await screen.findByRole("button", { name: /regenerate review/i }));

    await waitFor(() => expect(mocks.proposeSemanticRewrite).toHaveBeenCalledTimes(2));
    // The same paragraph, sent again. A regenerate that re-read the selection
    // or prompted differently would be a request the user did not ask for.
    const [first, second] = mocks.proposeSemanticRewrite.mock.calls;
    expect(second?.[0]).toBe(first?.[0]);
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
      expect(screen.getByRole("button", { name: "Apply revision" })).toBeDisabled(),
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

  it("reads the selection it was sent for, without asking for it again", async () => {
    /*
     * Arriving from the context menu. The user right-clicked a specific piece of
     * text, so making them select it a second time would be asking them to
     * repeat the gesture that brought them here.
     */
    mocks.getSelectionText.mockResolvedValue("  A sentence worth rewriting.  ");
    renderPage({ navigation: { target: "semantic", action: "read-selection" } });

    await waitFor(() =>
      expect(screen.getByText("A sentence worth rewriting.")).toBeInTheDocument(),
    );
    // Reading a selection must not start a request on its own.
    expect(mocks.proposeSemanticRewrite).not.toHaveBeenCalled();
  });

  it("does not read a selection when it was not sent for one", async () => {
    mocks.getSelectionText.mockResolvedValue("Some text.");
    renderPage({ navigation: { target: "semantic" } });

    await waitFor(() => expect(mocks.getSelectionText).not.toHaveBeenCalled());
  });

  it("says plainly that nothing can be checked without a profile", () => {
    // The context-menu path lands here with no profile more often than the
    // navigation path does, and "no measured style to show" did not tell the
    // user why the rewrite they came for is unavailable.
    mocks.loadSemanticProfileRecord.mockReturnValue(null);
    renderPage();

    expect(screen.getByRole("heading", { name: /no semantic profile is active/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /propose rewrite/i })).toBeDisabled();
  });

  it("enables the ribbon control once a profile exists", async () => {
    // The button ships disabled in the manifest; learning a profile here is
    // what turns it on. Without this the user would have a button that never
    // becomes clickable no matter what they do on this page.
    renderPage();
    await waitFor(() => expect(syncRibbon).toHaveBeenCalledWith(true));
  });

  it("keeps the ribbon control disabled with no profile", async () => {
    mocks.loadSemanticProfileRecord.mockReturnValue(null);
    renderPage();
    await waitFor(() => expect(syncRibbon).toHaveBeenCalledWith(false));
  });
});

describe("managing semantic profiles from the Semantic tab", () => {
  /*
   * F5. Every writer this needs — `selectKindRecordList`,
   * `setActiveSemanticProfile`, `createSemanticProfileRecord`, `removeSemanticProfile`
   * — already existed in the persistence layer and had no caller. The tab could
   * only ever show the one profile Learn Style had just made.
   */

  it("lists the profiles and marks the active one", () => {
    mocks.loadState.mockReturnValue(twoProfileState());
    renderPage();

    const list = screen.getByRole("list", { name: "Semantic profiles" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    // The one the rewrite is currently matching, named rather than a bare
    // "Active" that would be ambiguous the moment a second profile exists.
    expect(within(list).getByText(/^Active/)).toHaveTextContent("Active — Learned semantic style");
  });

  it("gives every row a button that says which profile it acts on", () => {
    /*
     * Three buttons all reading "Use this one" is not a list a screen reader user
     * can navigate: nothing distinguishes them but position.
     */
    mocks.loadState.mockReturnValue(twoProfileState());
    renderPage();

    expect(screen.getByRole("button", { name: "Use this one — Second voice" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete Learned semantic style" }),
    ).toBeInTheDocument();
  });

  it("offers a route in when there is no profile at all", () => {
    /*
     * Learn Style needs a sample that passes the quality gate, so for a document
     * too short to sample, the create-empty path is the only way onto this tab.
     */
    mocks.loadState.mockReturnValue({
      ...semanticState(),
      activeSemanticProfileId: null,
      semanticProfileRecords: {},
    });
    mocks.loadSemanticProfileRecord.mockReturnValue(null);
    renderPage();

    expect(screen.getByRole("button", { name: /create empty profile/i })).toBeInTheDocument();
  });

  it("creates a profile without a model and without a sample", async () => {
    /*
     * A blank profile is the whole point: it must not require a provider, because
     * a user with no LLM configured is exactly who cannot learn from a sample.
     */
    mocks.loadState.mockReturnValue({
      ...semanticState(),
      activeSemanticProfileId: null,
      semanticProfileRecords: {},
    });
    mocks.createSemanticProfileRecord.mockReturnValue(secondRecord());
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /create empty profile/i }));

    expect(mocks.createSemanticProfileRecord).toHaveBeenCalledTimes(1);
    // The kind is passed explicitly, or the record would land in the
    // deterministic namespace and diverge from what the tab edits.
    expect(mocks.learnStyleDraft).not.toHaveBeenCalled();
    expect(mocks.proposeSemanticRewrite).not.toHaveBeenCalled();
  });

  it("switches to another profile and drops the proposal made against the old one", async () => {
    mocks.loadState.mockReturnValue(twoProfileState());
    mocks.getSelectionText.mockResolvedValue("A sentence worth rewriting.");
    mocks.proposeSemanticRewrite.mockResolvedValue(sampleFinding({ actionable: true }));
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /read current selection/i }));
    await userEvent.click(screen.getByRole("button", { name: /propose rewrite/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Apply revision" })).toBeEnabled(),
    );

    await userEvent.click(screen.getByRole("button", { name: /use this one — second voice/i }));

    expect(mocks.setActiveSemanticProfile).toHaveBeenCalledWith(SECOND_ID);
    expect(mocks.loadSemanticProfileRecord).toHaveBeenLastCalledWith(SECOND_ID);
    // A rewrite matching the previous voice must not survive the switch.
    expect(screen.queryByRole("button", { name: "Apply revision" })).toBeNull();
  });

  it("marks the switched-to profile active rather than the one it came from", async () => {
    /*
     * `initial.state` is a snapshot read once. Deriving the active id from it
     * would leave the list still claiming the previous profile is in effect —
     * so the user would believe the rewrite is matching a voice they just left.
     */
    mocks.loadState.mockReturnValue(twoProfileState());
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /use this one — second voice/i }));

    expect(screen.getByText(/^Active: Second voice,/)).toBeInTheDocument();
  });

  it("returns to no profile when the only profile is deleted", async () => {
    /*
     * A store that actually changes, so the page's post-delete re-read sees an
     * empty list. Returning a fixed state would have left the profile on screen
     * and the test would have passed while proving nothing.
     */
    let stored = semanticState() as {
      activeSemanticProfileId: string | null;
      semanticProfileRecords: Record<string, unknown>;
    };
    stored = { ...stored, semanticProfileRecords: { [FIRST_ID]: record() } };
    mocks.loadState.mockImplementation(() => stored);
    mocks.removeSemanticProfile.mockImplementation(() => {
      stored = { activeSemanticProfileId: null, semanticProfileRecords: {} };
    });
    mocks.loadSemanticProfileRecord.mockReturnValue(null);
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /delete learned semantic style/i }));

    expect(mocks.removeSemanticProfile).toHaveBeenCalledWith(FIRST_ID);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /no semantic profile is active/i })).toBeVisible(),
    );
    expect(screen.getByText(/no semantic profiles yet/i)).toBeInTheDocument();
    // Nothing is in effect, so the ribbon control must go back off.
    await waitFor(() => expect(syncRibbon).toHaveBeenLastCalledWith(false));
  });
});
