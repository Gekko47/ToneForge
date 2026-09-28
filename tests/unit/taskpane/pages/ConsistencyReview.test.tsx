import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConsistencyReview from "../../../../src/taskpane/pages/ConsistencyReview";

const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  getStructuredSnapshot: vi.fn(),
  runConsistencyReview: vi.fn(),
}));

vi.mock("../../../../src/core/state/persistence", () => ({
  loadState: () => mocks.loadState(),
}));

vi.mock("../../../../src/word/documentReader", () => ({
  getStructuredSnapshot: () => mocks.getStructuredSnapshot(),
}));

vi.mock("../../../../src/analysis/consistency", () => ({
  previewStatements: () => ({ length: 1 }),
  runConsistencyReview: (...args: unknown[]) => mocks.runConsistencyReview(...args),
}));

vi.mock("../../../../src/taskpane/components/AiReviewSection", () => ({
  default: ({
    stage,
    onStart,
    onConfirm,
    onCancelRun,
    message,
  }: {
    stage: string;
    onStart: () => void;
    onConfirm: () => void;
    onCancelRun: () => void;
    message: string | null;
  }) => (
    <section aria-label="Consistency Review">
      <p data-testid="stage">{stage}</p>
      <p data-testid="message">{message ?? ""}</p>
      <button type="button" onClick={onStart}>
        Check Consistency
      </button>
      <button type="button" onClick={onConfirm}>
        Confirm
      </button>
      <button type="button" onClick={onCancelRun}>
        Cancel run
      </button>
    </section>
  ),
}));

function installSettings(overrides: Record<string, unknown> = {}): void {
  mocks.loadState.mockReturnValue({
    settings: {
      llmProvider: "mock",
      openAiBaseUrl: "http://127.0.0.1:8787",
      consistencyReviewConsent: true,
      openAiModel: "gpt-test",
      ...overrides,
    },
    providerConnections: {},
  });
}

describe("ConsistencyReview page", () => {
  beforeEach(() => {
    mocks.loadState.mockReset();
    mocks.getStructuredSnapshot.mockReset();
    mocks.runConsistencyReview.mockReset();
    installSettings();
    mocks.getStructuredSnapshot.mockResolvedValue({
      contentHash: "hash-1",
      nodes: [
        { type: "heading", text: "Intro" },
        { type: "paragraph", text: "Onboarding is manual." },
      ],
    });
  });

  it("starts idle and reads no document until asked", async () => {
    /*
     * Reading the document on mount would mean a user who opened the tab had
     * already had their document collected for a review they did not start.
     */
    render(
      <ConsistencyReview
        onBack={vi.fn()}
        onOpenSettings={vi.fn()}
        result={null}
        onResult={vi.fn()}
      />,
    );

    expect(screen.getByTestId("stage")).toHaveTextContent("idle");
    expect(mocks.getStructuredSnapshot).not.toHaveBeenCalled();
  });

  it("refuses to read the document at all when consent is absent", async () => {
    installSettings({ consistencyReviewConsent: false });
    render(
      <ConsistencyReview
        onBack={vi.fn()}
        onOpenSettings={vi.fn()}
        result={null}
        onResult={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Check Consistency" }));

    expect(mocks.getStructuredSnapshot).not.toHaveBeenCalled();
    expect(screen.getByTestId("message")).toHaveTextContent(/needs its own consent/i);
  });

  it("opens a preflight that counts the document it will send", async () => {
    render(
      <ConsistencyReview
        onBack={vi.fn()}
        onOpenSettings={vi.fn()}
        result={null}
        onResult={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Check Consistency" }));

    await waitFor(() => expect(screen.getByTestId("stage")).toHaveTextContent("preflight"));
    expect(mocks.getStructuredSnapshot).toHaveBeenCalledTimes(1);
  });

  it("hands the finished report upward rather than keeping it", async () => {
    /*
     * The report belongs to the Dashboard because Document Governance's findings
     * list shows it on another tab. A page that kept its own copy would drop the
     * findings the moment the user navigated across to read them.
     */
    const onResult = vi.fn();
    const report = { revision: "hash-1", issues: [], coverage: {}, usedModel: false };
    mocks.runConsistencyReview.mockResolvedValue(report);
    render(
      <ConsistencyReview
        onBack={vi.fn()}
        onOpenSettings={vi.fn()}
        result={null}
        onResult={onResult}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Check Consistency" }));
    await waitFor(() => expect(screen.getByTestId("stage")).toHaveTextContent("preflight"));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(report));
  });

  it("refuses a send when consent was withdrawn while the preflight was open", async () => {
    /*
     * Consent can be withdrawn in Settings between the disclosure and the send.
     * The engine's own gate is the backstop; this is the check that stops the
     * document leaving at all.
     */
    mocks.runConsistencyReview.mockRejectedValue(new Error("consent is required in Settings"));
    render(
      <ConsistencyReview
        onBack={vi.fn()}
        onOpenSettings={vi.fn()}
        result={null}
        onResult={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Check Consistency" }));
    await waitFor(() => expect(screen.getByTestId("stage")).toHaveTextContent("preflight"));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(screen.getByTestId("message")).toHaveTextContent(/consent is required/i),
    );
  });

  it("offers a route back to Document Governance", async () => {
    const onBack = vi.fn();
    render(
      <ConsistencyReview
        onBack={onBack}
        onOpenSettings={vi.fn()}
        result={null}
        onResult={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Back to Document Governance" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
