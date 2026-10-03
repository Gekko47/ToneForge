/**
 * The two card densities, and the manual-correction state (UX-3a, UX-3, UX-1).
 *
 * These are presentation contracts, so they are asserted on what is rendered.
 * The one thing they deliberately do *not* do is restate the review gate: a
 * correctable finding still goes through `reviewFinding` unchanged, and ND-11
 * recorded that path as already verified.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import FindingDetail from "../../../../src/taskpane/components/FindingDetail";
import { FindingSchema, type Finding } from "../../../../src/core/domain/Finding";

function finding(overrides: Partial<Finding> = {}): Finding {
  return FindingSchema.parse({
    kind: "deterministic",
    id: "f47ac10b-58cc-4372-a567-0e02b2c3d480",
    category: "typography.emDash",
    ruleId: "typography/emDash",
    message: "a straight double hyphen is used where the profile calls for an em dash",
    severity: "warning",
    risk: "none",
    range: { start: 10, end: 12, unit: "character" },
    source: "deterministic",
    nodeIds: [],
    actionable: true,
    actual: "--",
    expected: "—",
    ...overrides,
  });
}

const actions = () => ({
  onReview: vi.fn(),
  onSkip: vi.fn(),
  onUndo: vi.fn(),
  onIgnore: vi.fn(),
});

describe("the deterministic variant", () => {
  it("summarises in one line, without the source and risk tokens", () => {
    const { container } = render(
      <FindingDetail finding={finding()} variant="deterministic" {...actions()} />,
    );

    const meta = container.querySelector(".tf-finding-meta");
    expect(meta?.textContent).toContain("Warning");
    expect(meta?.textContent).not.toContain("Risk:");
    expect(meta?.textContent).not.toContain("Document scan");
  });

  /*
   * Moved, not dropped (UX-3).
   *
   * The owner asked for source, risk and the raw range to move into a collapsed
   * detail region. Deleting them instead would have satisfied the same test with
   * far less work and thrown away information the card used to carry.
   */
  it("keeps source, risk and the location in a collapsed detail region", () => {
    const { container } = render(
      <FindingDetail finding={finding()} variant="deterministic" {...actions()} />,
    );

    const region = container.querySelector(".tf-finding-detail-region");
    expect(region).not.toBeNull();
    expect(region?.tagName).toBe("DETAILS");
    expect(region?.textContent).toContain("Document scan");
    expect(region?.textContent).toContain("Risk: None");
    expect(region?.textContent).toContain("Location:");
  });

  it("renders Actual and Expected as one before-and-after, not two paragraphs", () => {
    const { container } = render(
      <FindingDetail finding={finding()} variant="deterministic" {...actions()} />,
    );

    const line = container.querySelector(".tf-finding-detail-line");
    expect(line?.textContent).toContain("--");
    expect(line?.textContent).toContain("→");
    expect(line?.textContent).toContain("—");
    expect(container.querySelector(".tf-finding-actual")?.textContent).toBe("--");
    expect(container.querySelector(".tf-finding-expected")?.textContent).toBe("—");
  });

  /*
   * A finding with an `expected` and no `actual` is not a substitution —
   * a missing element, say. Rendering "→ <expected>" would claim a before-state
   * that does not exist, so the labelled single-value form is kept.
   */
  it("does not render an arrow when there is no actual value to precede", () => {
    const { container } = render(
      <FindingDetail
        finding={finding({ actual: undefined })}
        variant="deterministic"
        {...actions()}
      />,
    );

    expect(container.textContent).not.toContain("→");
    expect(container.textContent).toContain("Expected:");
  });
});

describe("the consistency variant", () => {
  it("keeps the full header, because risk and context are the information there", () => {
    const { container } = render(
      <FindingDetail
        finding={finding({ source: "ai", risk: "medium" })}
        variant="consistency"
        {...actions()}
      />,
    );

    const meta = container.querySelector(".tf-finding-meta");
    expect(meta?.textContent).toContain("AI");
    expect(meta?.textContent).toContain("Current AI review");
    expect(meta?.textContent).toContain("Risk: Medium");
  });

  it("prints the location in a footer rather than a collapsed region", () => {
    const { container } = render(
      <FindingDetail finding={finding()} variant="consistency" {...actions()} />,
    );

    expect(container.querySelector(".tf-finding-location")?.textContent).toContain("Location:");
    expect(container.querySelector(".tf-finding-detail-region")).toBeNull();
  });
});

describe("a finding ToneForge will not correct (UX-1)", () => {
  const manual = (): { reason: string; container: HTMLElement } => {
    const approveRefusal = "a heading level is part of the document outline, not a paragraph style";
    const { container } = render(
      <FindingDetail
        finding={finding({
          deterministic: {
            profilePath: "structure.headingHierarchy",
            correctionAvailable: false,
            correctionReason: approveRefusal,
          },
        })}
        variant="deterministic"
        approveRefusal={approveRefusal}
        {...actions()}
      />,
    );
    return { reason: approveRefusal, container };
  };

  it("omits Approve rather than offering one that cannot be pressed", () => {
    manual();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("keeps Go to text, which is what a manual correction needs", () => {
    manual();
    expect(screen.getByRole("button", { name: "Go to text" })).toBeEnabled();
  });

  it("keeps Skip, because declining is always a real decision", () => {
    manual();
    expect(screen.getByRole("button", { name: "Skip" })).toBeEnabled();
  });

  it("states that the correction is manual, and why", () => {
    const { reason, container } = manual();
    const stated = container.querySelector(".tf-finding-manual")?.textContent ?? "";
    expect(stated).toContain("Manual correction required.");
    expect(stated).toContain(reason);
  });
});

describe("a finding ToneForge can correct", () => {
  it("still offers Approve, and says nothing about manual correction", () => {
    const { container } = render(
      <FindingDetail finding={finding()} variant="deterministic" {...actions()} />,
    );

    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(container.querySelector(".tf-finding-manual")).toBeNull();
  });
});
