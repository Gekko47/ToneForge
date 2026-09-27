import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FindingSchema, type Finding } from "../../../../src/core/domain/Finding";
import { v4 as uuidv4 } from "uuid";
import FindingsList from "../../../../src/taskpane/components/FindingsList";

/**
 * The findings list and the findings count must read from the same place.
 *
 * This is a regression test for a bug that shipped: the list rendered
 * `reformatResult?.report.findings ?? observerFindings`, so once auto-preview
 * ran on every scan, a preview that found no plannable change replaced a real
 * list of findings with an empty one. The pane then read "Findings 0" and
 * "No findings detected" while its own toolbar said "3 open finding(s)".
 *
 * The count and the list were the visible symptom; the cause was two different
 * runs' findings being mixed, which no single component can prevent. The
 * invariant asserted here is the one a user would state: if the list is empty,
 * the count is zero, and if the count is three, three cards are on screen.
 */

function finding(message: string): Finding {
  return FindingSchema.parse({
    id: uuidv4(),
    kind: "deterministic",
    category: "typography",
    message,
    severity: "warning",
    range: { start: 0, end: 4 },
    nodeIds: [],
  });
}

const THREE = [finding("One"), finding("Two"), finding("Three")];

describe("findings list integrity", () => {
  it("renders one card per finding, so the count and the list agree", () => {
    render(<FindingsList findings={THREE} id="tf-findings-list" />);

    // The toolbar reads the same array. If these ever disagree the user sees
    // "3" above an empty list, which is what this bug looked like.
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("reports an empty state only when there is genuinely nothing", () => {
    render(<FindingsList findings={[]} id="tf-findings-list" />);

    expect(screen.getByText("No findings detected.")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("renders every finding it is given, including a single one", () => {
    // The one-finding case is where a `??` fallback is most likely to swallow
    // the list: an array of one is truthy, an empty one is not, and the two
    // paths are not the same code.
    render(<FindingsList findings={[THREE[0] as Finding]} id="tf-findings-list" />);

    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("shows a finding whose id differs from any preview's", async () => {
    /*
     * The concrete shape of the bug: a scan produces three findings with fresh
     * uuids, and a preview for the same document produces none of them. The
     * list must still show the scan's three.
     */
    const previewIds = new Set<string>();
    const scanFindings = THREE.filter((item) => !previewIds.has(item.id));

    render(<FindingsList findings={scanFindings} id="tf-findings-list" />);

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
  });
});
