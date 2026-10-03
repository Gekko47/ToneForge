/**
 * The occurrence group as the user meets it (spec §13, §15; UX-2, D6).
 *
 * What is asserted here cannot be asserted in `findingGroups.test.ts`: that the
 * group *renders* as one identified set, that "Approve all" is disabled carrying
 * the engine's own reason rather than hidden, and that pressing it calls the
 * caller — which is what turns `batchApproval` from unreachable code (ND-7) into
 * a control a person can press.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FindingsList from "../../../../src/taskpane/components/FindingsList";
import type { DeterministicFindingGroup } from "../../../../src/analysis/deterministic/contracts";
import { FindingSchema, type Finding } from "../../../../src/core/domain/Finding";

function finding(id: string, overrides: Partial<Finding> = {}): Finding {
  return FindingSchema.parse({
    kind: "deterministic",
    category: "typography.emDash",
    ruleId: "typography/emDash",
    message: "a straight double hyphen is used where the profile calls for an em dash",
    severity: "warning",
    range: { start: 10, end: 12, unit: "character" },
    source: "deterministic",
    nodeIds: [],
    actionable: true,
    ...overrides,
    // After the spread, so a caller cannot override the id its group names.
    id,
  });
}

function group(overrides: Partial<DeterministicFindingGroup> = {}): DeterministicFindingGroup {
  return {
    id: "typography.emDash",
    category: "typography.emDash",
    ruleId: "typography/emDash",
    expected: "—",
    occurrenceIds: [],
    safeBatchApproval: true,
    ...overrides,
  };
}

const twoOccurrences = () => {
  const first = finding("f47ac10b-58cc-4372-a567-0e02b2c3d470");
  const second = finding("f47ac10b-58cc-4372-a567-0e02b2c3d471", {
    range: { start: 80, end: 82, unit: "character" },
  });
  return { first, second, group: group({ occurrenceIds: [first.id, second.id] }) };
};

describe("an occurrence group", () => {
  it("names the category, the count and the correction, so the set is identified", () => {
    const { first, second, group: g } = twoOccurrences();
    render(<FindingsList findings={[first, second]} groups={[g]} />);

    expect(screen.getByText("typography.emDash · 2 occurrences · corrects to —")).toBeTruthy();
  });

  it("collapses its occurrences by default, so a group of fourteen does not bury the list", () => {
    const { first, second, group: g } = twoOccurrences();
    render(<FindingsList findings={[first, second]} groups={[g]} />);

    expect(screen.queryByText(first.message)).toBeNull();
    expect(screen.getByRole("button", { name: /Show 2 occurrence/ })).toBeTruthy();
  });

  it("reveals its occurrences on demand", async () => {
    const { first, second, group: g } = twoOccurrences();
    render(<FindingsList findings={[first, second]} groups={[g]} />);

    await userEvent.click(screen.getByRole("button", { name: /Show 2 occurrence/ }));

    expect(screen.getAllByText(first.message).length).toBeGreaterThan(0);
    expect(screen.getAllByText(second.message).length).toBeGreaterThan(0);
  });

  /*
   * The owner's requirement (D6), and the reason `batchRefusalReason` exists on
   * the group at all: a control that cannot be pressed must say why. Hiding it
   * would leave the reader unable to tell "one at a time" from "not offered".
   */
  it("disables Approve all carrying the engine's own reason, and never hides it", () => {
    const { first, second } = twoOccurrences();
    render(
      <FindingsList
        findings={[first, second]}
        groups={[
          group({
            // The occurrences must be named, or this is an empty group and both
            // findings render as plain cards with no header and no control.
            occurrenceIds: [first.id, second.id],
            safeBatchApproval: false,
            batchRefusalReason: "these occurrences do not share one correction",
          }),
        ]}
        onApproveAll={() => undefined}
      />,
    );

    const approve = screen.getByRole("button", { name: /Approve all unavailable/ });
    expect(approve.hasAttribute("disabled")).toBe(true);
    expect(approve.getAttribute("aria-describedby")).not.toBeNull();
    expect(screen.getByText("these occurrences do not share one correction")).toBeTruthy();
  });

  it("offers Approve all enabled when the engine declared the group safe", () => {
    const { first, second, group: g } = twoOccurrences();
    render(<FindingsList findings={[first, second]} groups={[g]} onApproveAll={() => undefined} />);

    const approve = screen.getByRole("button", { name: /Approve all 2 occurrences/ });
    expect(approve.hasAttribute("disabled")).toBe(false);
  });

  /*
   * User opt-in, stated as a test: rendering a safe group must not decide
   * anything. The engine grouping fourteen equivalent occurrences well is not the
   * user consenting to all fourteen.
   */
  it("approves nothing merely by being rendered", () => {
    const onApproveAll = vi.fn();
    const { first, second, group: g } = twoOccurrences();
    render(<FindingsList findings={[first, second]} groups={[g]} onApproveAll={onApproveAll} />);

    expect(onApproveAll).not.toHaveBeenCalled();
  });

  it("approves the group only when the control is pressed", async () => {
    const onApproveAll = vi.fn();
    const { first, second, group: g } = twoOccurrences();
    render(<FindingsList findings={[first, second]} groups={[g]} onApproveAll={onApproveAll} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve all 2 occurrences/ }));

    expect(onApproveAll).toHaveBeenCalledTimes(1);
    expect(onApproveAll).toHaveBeenCalledWith(g);
  });

  it("declines the group only when that control is pressed", async () => {
    const onSkipAll = vi.fn();
    const { first, second, group: g } = twoOccurrences();
    render(<FindingsList findings={[first, second]} groups={[g]} onSkipAll={onSkipAll} />);

    await userEvent.click(screen.getByRole("button", { name: "Decline all" }));

    expect(onSkipAll).toHaveBeenCalledWith(g);
  });

  /*
   * A group whose occurrences came from another run must say so rather than
   * quietly offering to approve text that is not on screen.
   */
  it("states how many of its occurrences this run could not account for", () => {
    const { first, second } = twoOccurrences();
    render(
      <FindingsList
        findings={[first, second]}
        groups={[
          group({
            occurrenceIds: [
              first.id,
              second.id,
              // A third occurrence from a run this one did not produce.
              "f47ac10b-58cc-4372-a567-0e02b2c3d4ff",
            ],
            safeBatchApproval: false,
            batchRefusalReason: "these occurrences do not share one correction",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/1 of the occurrences this group was built from/)).toBeTruthy();
  });

  it("renders a lone occurrence as a plain card, with no group header", () => {
    const only = finding("f47ac10b-58cc-4372-a567-0e02b2c3d472");
    render(<FindingsList findings={[only]} groups={[group({ occurrenceIds: [only.id] })]} />);

    expect(screen.queryByText(/occurrences ·/)).toBeNull();
    expect(screen.getByText(only.message)).toBeTruthy();
  });

  it("renders every finding, including one no group claimed", () => {
    const grouped = finding("f47ac10b-58cc-4372-a567-0e02b2c3d473");
    const loose = finding("f47ac10b-58cc-4372-a567-0e02b2c3d474", {
      category: "typography.ellipsis",
      message: "three dots are used where the profile calls for an ellipsis character",
    });
    render(
      <FindingsList
        findings={[grouped, loose]}
        groups={[group({ occurrenceIds: [grouped.id] })]}
      />,
    );

    expect(screen.getByText(loose.message)).toBeTruthy();
  });
});

describe("the group header's action region", () => {
  it("is labelled, so a screen reader announces which set the controls act on", () => {
    const { first, second, group: g } = twoOccurrences();
    render(<FindingsList findings={[first, second]} groups={[g]} />);

    const nav = screen.getByRole("navigation", {
      name: "Actions for typography.emDash",
    });
    expect(within(nav).getAllByRole("button").length).toBeGreaterThan(0);
  });
});
