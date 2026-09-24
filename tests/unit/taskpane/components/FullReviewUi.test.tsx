import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { v4 as uuidv4 } from "uuid";
import { createChangePlan } from "../../../../src/core/domain/ChangePlan";
import { FindingSchema } from "../../../../src/core/domain/Finding";
import FullReviewPreflight from "../../../../src/taskpane/components/FullReviewPreflight";
import FullReviewProgress from "../../../../src/taskpane/components/FullReviewProgress";
import FullReviewResults from "../../../../src/taskpane/components/FullReviewResults";
import AiReviewResult from "../../../../src/taskpane/components/AiReviewResult";

describe("full review and AI result UI states", () => {
  it("shows scope, protection, batching, start, and cancel controls", () => {
    const start = vi.fn();
    const cancel = vi.fn();
    render(
      <FullReviewPreflight
        nodeCount={12}
        approximateWords={340}
        protectedCount={2}
        providerName="mock"
        onStart={start}
        onCancel={cancel}
      />,
    );
    expect(screen.getByText(/12 editable node/)).toBeInTheDocument();
    expect(screen.getByText(/2 protected node/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(start).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("announces progress and partial cancellation", () => {
    render(<FullReviewProgress completed={2} total={4} partial onCancel={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 of 4 batches complete (50%)");
    expect(screen.getByRole("alert")).toHaveTextContent(/partial/i);
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "2");
  });

  it("shows result counts and a disabled plan action for an empty result", () => {
    const plan = createChangePlan("hash", "doc", []);
    render(
      <FullReviewResults
        findings={[]}
        plan={plan}
        onReviewFindings={vi.fn()}
        onCreatePlan={vi.fn()}
      />,
    );
    expect(screen.getByText(/0 finding/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create change plan" })).toBeDisabled();
  });

  it("renders AI evidence before offering a preview", () => {
    const finding = FindingSchema.parse({
      id: uuidv4(),
      kind: "semantic",
      category: "editorial.clarity",
      range: { start: 0, end: 4, unit: "character" },
      message: "Potential issue",
      severity: "warning",
      evidence: "word",
      actual: "word",
      expected: "clear wording",
      explanation: "This improves clarity.",
      source: "ai",
      confidence: 0.8,
    });
    const plan = createChangePlan("hash", "doc", []);
    render(
      <AiReviewResult
        findings={[finding]}
        plan={plan}
        provider="mock"
        onPreview={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Evidence: word")).toBeInTheDocument();
    expect(screen.getByText("Suggested revision: clear wording")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview changes" })).toBeDisabled();
  });
});
