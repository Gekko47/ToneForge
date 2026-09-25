import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import FindingsToolbar from "../../../../src/taskpane/components/FindingsToolbar";

describe("FindingsToolbar", () => {
  it("announces the task-first status and current finding position", () => {
    render(
      <FindingsToolbar
        label="3 open finding(s)"
        nextAction="Review findings"
        total={3}
        selectedIndex={1}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "3 open finding(s). Next: Review findings.",
    );
    expect(screen.getByText("Finding 2 of 3")).toBeInTheDocument();
  });

  it("invokes previous and next without a selection", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(
      <FindingsToolbar
        label="Clean"
        nextAction="Scan now"
        total={0}
        selectedIndex={null}
        onPrevious={onPrevious}
        onNext={onNext}
      />,
    );
    expect(screen.queryByRole("navigation", { name: "Finding navigation" })).toBeNull();
    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });
});
