/**
 * The Semantic Style page.
 *
 * Reassigned from the deleted `Semantic.test.tsx`, then rewritten when the page
 * absorbed the learning controls. What it pins is the split's whole claim: this
 * page is about the style, it sends nothing while you edit, it does not lock a
 * user out of their own profile for declining AI consent, and — the claim P8
 * added — learning produces a draft that does not become the active style
 * until a second, explicit press.
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
  saveSemanticSampleEvidence: vi.fn(),
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
  loadSemanticSampleEvidence: () => null,
  saveSemanticProfileRecord: mocks.saveSemanticProfileRecord,
  saveSemanticSampleEvidence: mocks.saveSemanticSampleEvidence,
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
/** A different id, so a freshly learned draft is visibly not the active one. */
const LEARNED_ID = "7c4b1e90-3d55-4a1c-8e6b-91d0f2a3b5c7";

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

/**
 * A sample of `count` words in two sentences.
 *
 * The eligibility gate is 40 words and 2 sentences; the quality bands start at
 * 100. 60 is therefore the case D7 is about — learnable, but thin enough that
 * the level has to be acknowledged — and 320 is the case where it does not.
 */
function sampleOf(count: number): string {
  const half = Math.floor(count / 2);
  const first = Array.from({ length: half }, (_unused, index) => `word${index}`).join(" ");
  const second = Array.from({ length: count - half }, (_unused, index) => `other${index}`).join(
    " ",
  );
  return `${first}. ${second}.`;
}

/** What the page does with a passed sample, minus the real profiler's work. */
function stubLearnedSample(source = "pasted_text" as const): void {
  mocks.learnStyleDraft.mockResolvedValue({
    draft: createEmptyProfile("Learned semantic style", 1, "semantic"),
    evidence: {
      sampleId: PROFILE_ID,
      source,
      wordCount: 60,
      sentenceCount: 2,
      level: "insufficient",
      pass: true,
      reasons: [],
      paragraphCount: 1,
      capturedAt: "2026-10-01T09:00:00.000Z",
      sampleHash: "abc",
      measured: createEmptyProfile("Learned semantic style", 1, "semantic").measured,
      semanticIncluded: false,
    },
  });
  // Seeded, because a record with no draft has no effective profile and the
  // page would then render its "no profile" branch instead of the draft it has
  // just learned.
  mocks.createSemanticProfileRecord.mockReturnValue(
    createRecord(
      LEARNED_ID,
      "Learned semantic style",
      "2026-10-01T09:00:00.000Z",
      createEmptyProfile("Learned semantic style", 1, "semantic"),
      "semantic",
    ),
  );
}

describe("the Semantic Style page", () => {
  beforeEach(() => {
    mocks.state = semanticState();
    mocks.learnStyleDraft.mockReset();
    mocks.saveSemanticProfileRecord.mockReset();
    mocks.saveSemanticSampleEvidence.mockReset();
    mocks.createSemanticProfileRecord.mockReset();
    mocks.syncSemanticRibbon.mockReset();
    mocks.setActiveSemanticProfile.mockReset();
    mocks.isRemoteProviderConfigured.mockReturnValue(true);
  });

  describe("the measured block", () => {
    it("hides every measured metric behind a disclosure, because none of them govern the review", () => {
      renderPage();

      // D9 and ADR-0076: the numbers are still here and still all eight, but a
      // reader who has to pass them to reach the editor has been told they
      // matter. Deleting them instead is what the old proposal asked for.
      expect(screen.getByRole("heading", { name: /sample diagnostics/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /show diagnostics/i })).toBeInTheDocument();
      expect(screen.queryByText("Average sentence length")).toBeNull();
    });

    it("shows every one of them once the disclosure is opened", async () => {
      renderPage();

      await userEvent.click(screen.getByRole("button", { name: /show diagnostics/i }));

      // The deterministic editor rendered all eight; the Semantic tab rendered
      // four. Moving the block without the other four would have deleted them
      // from the interface while the engine kept using them.
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

    it("states a missing measurement as absent rather than as zero", async () => {
      renderPage();

      await userEvent.click(screen.getByRole("button", { name: /show diagnostics/i }));

      // A profile learned from too short a sample has no value here, and
      // printing "0" would be a different claim.
      expect(screen.getAllByText("not measured yet").length).toBeGreaterThan(0);
    });
  });

  describe("consent", () => {
    it("does not let missing consent lock the user out of editing their own style", () => {
      mocks.state = semanticState(false);
      renderPage();

      // Consent governs sending prose to a provider; typing a tone sends
      // nothing. Conflating them locks out exactly the user who declined.
      // Level 2, because the page title and the editor's own section are both
      // called "Semantic style" and the editor is the one that has to be here.
      expect(
        screen.getByRole("heading", { level: 2, name: /^semantic style$/i }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /no semantic profile is active/i })).toBeNull();
    });

    it("explains why learning is blocked when consent is missing, and names the control", () => {
      mocks.state = semanticState(false);
      renderPage();

      expect(screen.getByText(/needs its own consent in Settings/i)).toBeInTheDocument();
      // ADR-0069: a disabled control with no visible reason is indistinguishable
      // from a broken one.
      expect(screen.getByRole("button", { name: /learn style/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /open settings/i })).toBeInTheDocument();
    });
  });

  describe("learning", () => {
    it("learns from the pasted box without reading the document", async () => {
      stubLearnedSample();
      renderPage();

      await userEvent.click(screen.getByLabelText(/paste a sample of your writing/i));
      await userEvent.paste(sampleOf(320));
      await userEvent.click(screen.getByRole("button", { name: /use this text/i }));
      await userEvent.click(await screen.findByRole("button", { name: /learn style/i }));

      await waitFor(() => expect(mocks.learnStyleDraft).toHaveBeenCalledTimes(1));
      expect(mocks.getDocumentSnapshot).not.toHaveBeenCalled();
      expect(mocks.getSelectionText).not.toHaveBeenCalled();
      expect(mocks.learnStyleDraft.mock.calls[0]![0]).toMatchObject({ source: "pasted_text" });
    });

    it("cannot fire with an empty box, rather than reporting a bad sample", () => {
      renderPage();

      expect(screen.getByRole("button", { name: /use this text/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /learn style/i })).toBeDisabled();
      expect(mocks.learnStyleDraft).not.toHaveBeenCalled();
    });

    it("records where the sample came from without keeping the sample", async () => {
      stubLearnedSample();
      renderPage();

      await userEvent.click(screen.getByLabelText(/paste a sample of your writing/i));
      await userEvent.paste(sampleOf(320));
      await userEvent.click(screen.getByRole("button", { name: /use this text/i }));
      await userEvent.click(await screen.findByRole("button", { name: /learn style/i }));

      await waitFor(() => expect(mocks.saveSemanticSampleEvidence).toHaveBeenCalledTimes(1));
      const evidence = mocks.saveSemanticSampleEvidence.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(evidence).toMatchObject({ source: "pasted_text", wordCount: 60, sampleHash: "abc" });
      // The evidence schema is metadata-only by construction, and this is the
      // test that would notice if a sample were ever added to it.
      expect(evidence["text"]).toBeUndefined();
    });

    it("refuses a document file with the reason, rather than reading it as prose", async () => {
      renderPage();

      const file = new File(["PK archive bytes"], "expert-report.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      await userEvent.upload(screen.getByLabelText(/choose a plain-text file/i), file);

      expect(await screen.findByText(/binary archive/i)).toBeInTheDocument();
      expect(mocks.learnStyleDraft).not.toHaveBeenCalled();
    });

    it("carries the quality level as a badge that outlives the acknowledgement", async () => {
      renderPage();

      await userEvent.click(screen.getByLabelText(/paste a sample of your writing/i));
      await userEvent.paste(sampleOf(60));
      await userEvent.click(screen.getByRole("button", { name: /use this text/i }));

      // D7: a level is a statement of confidence, not a permission. A transient
      // warning trains users to dismiss the one signal that would matter at 40
      // words, so the badge stays and says what the sample is.
      const badge = await screen.findByTestId("sample-quality");
      expect(badge).toHaveTextContent("60 words");
      expect(badge).toHaveTextContent("insufficient");
    });

    it("says the level is not a block, on a sample it will learn from", async () => {
      renderPage();

      await userEvent.click(screen.getByLabelText(/paste a sample of your writing/i));
      await userEvent.paste(sampleOf(320));
      await userEvent.click(screen.getByRole("button", { name: /use this text/i }));

      const badge = await screen.findByTestId("sample-quality");
      expect(badge).toHaveTextContent("good");
      // The only sentence that says "cannot be learned" is for an ineligible
      // sample. A level of confidence must never read as a refusal.
      expect(screen.queryByText(/cannot be learned from yet/i)).toBeNull();
    });

    it("asks for an explicit acknowledgement on a thin but eligible sample", async () => {
      stubLearnedSample();
      renderPage();

      await userEvent.click(screen.getByLabelText(/paste a sample of your writing/i));
      await userEvent.paste(sampleOf(60));
      await userEvent.click(screen.getByRole("button", { name: /use this text/i }));

      const learn = await screen.findByRole("button", { name: /learn style/i });
      expect(learn).toBeDisabled();
      await userEvent.click(screen.getByLabelText(/learn from this sample anyway/i));
      expect(screen.getByRole("button", { name: /learn style/i })).toBeEnabled();
    });
  });

  describe("the draft/active split", () => {
    it("does not activate what it just learned", async () => {
      stubLearnedSample();
      renderPage();

      await userEvent.click(screen.getByLabelText(/paste a sample of your writing/i));
      await userEvent.paste(sampleOf(320));
      await userEvent.click(screen.getByRole("button", { name: /use this text/i }));
      await userEvent.click(await screen.findByRole("button", { name: /learn style/i }));

      await waitFor(() => expect(mocks.createSemanticProfileRecord).toHaveBeenCalledTimes(1));
      // Spec §11: the old path activated whatever it learned, so the review
      // pipeline switched to a voice the user had not looked at yet.
      expect(mocks.createSemanticProfileRecord.mock.calls[0]![3]).toEqual({ activate: false });
      expect(mocks.setActiveSemanticProfile).not.toHaveBeenCalled();
    });

    it("activates only on the second, explicit press", async () => {
      stubLearnedSample();
      renderPage();

      await userEvent.click(screen.getByLabelText(/paste a sample of your writing/i));
      await userEvent.paste(sampleOf(320));
      await userEvent.click(screen.getByRole("button", { name: /use this text/i }));
      await userEvent.click(await screen.findByRole("button", { name: /learn style/i }));

      // The learned record has a different id from the active one, so this
      // button is the evidence that learning did not activate anything.
      const activate = await screen.findByRole("button", { name: /make this active/i });
      expect(mocks.setActiveSemanticProfile).not.toHaveBeenCalled();
      await userEvent.click(activate);
      expect(mocks.setActiveSemanticProfile).toHaveBeenCalledWith(LEARNED_ID);
    });

    it("says a draft that is not active is not steering the reviews", async () => {
      stubLearnedSample();
      renderPage();

      await userEvent.click(screen.getByLabelText(/paste a sample of your writing/i));
      await userEvent.paste(sampleOf(320));
      await userEvent.click(screen.getByRole("button", { name: /use this text/i }));
      await userEvent.click(await screen.findByRole("button", { name: /learn style/i }));

      expect(
        await screen.findByText(/still uses the profile you chose before/i),
      ).toBeInTheDocument();
    });
  });

  it("wires the semantic record's own revision history", () => {
    renderPage();

    // The section was rendered only on the deterministic Profile page, so a
    // learned profile had publish, activate and recall controls the user could
    // not reach (spec §31). The heading is matched exactly because the section
    // also renders a "Revision audit trail" region below it.
    expect(screen.getByRole("heading", { name: "Profile revisions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /publish draft/i })).toBeInTheDocument();
  });

  it("keeps exactly one live region, even with the record section mounted", () => {
    renderPage();

    // ADR-0062: one per page. `ProfileRecordSection` renders its own polite
    // region on the Profile page, where nothing else speaks; mounted here it
    // hands the sentence to this page's region instead, so publishing a draft
    // cannot speak from a second place.
    expect(document.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(1);
  });

  it("speaks a record action from the page's own region", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /publish draft/i }));

    // The one region's content, not a second region's.
    const region = document.querySelector('[role="status"]');
    expect(region?.textContent).toMatch(/draft published/i);
  });
});
