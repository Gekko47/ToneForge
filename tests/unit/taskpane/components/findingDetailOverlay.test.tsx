/**
 * The finding detail overlay — one finding at a time, with accept actions.
 *
 * The overlay is the review surface: it shows one finding and offers Accept and
 * Accept all of this type, and reports the remaining count. Skip and Ignore are
 * not repeated here — they are per-finding decisions that belong with the
 * finding's own controls.
 *
 * These tests pin the action wiring, the coverage-disabled state, and the
 * header: the count and the arrows are one unit beside the title, and the
 * finding's own Skip/Ignore are gone.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FindingDetailOverlay from "../../../../src/taskpane/components/FindingDetailOverlay";
import { FindingSchema, type Finding } from "../../../../src/core/domain/Finding";
import type { FindingTypeGroup } from "../../../../src/taskpane/findingsByType";

function finding(overrides: Partial<Finding> = {}): Finding {
  return FindingSchema.parse({
    kind: "deterministic",
    id: "f47ac10b-58cc-4372-a567-0e02b2c3d480",
    category: "typography.emDash",
    ruleId: "typography.emDash",
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

function group(overrides: Partial<FindingTypeGroup> = {}): FindingTypeGroup {
  return {
    key: "typography.emDash",
    label: "Em dash",
    ruleName: "Em dash",
    parent: "Typography",
    icon: "deterministicReview",
    count: 2,
    findings: [finding(), finding({ id: "f47ac10b-58cc-4372-a567-0e02b2c3d481" })],
    ...overrides,
  };
}

const handlers = () => ({
  onClose: vi.fn(),
  onPrevious: vi.fn(),
  onNext: vi.fn(),
  onAccept: vi.fn(),
  onAcceptAll: vi.fn(),
  onSkip: vi.fn(),
  onIgnore: vi.fn(),
  onRestore: vi.fn(),
});

describe("FindingDetailOverlay", () => {
  function renderInDialog(overrides: Record<string, unknown> = {}) {
    const g = group();
    const h = handlers();
    const result = render(
      <FindingDetailOverlay
        group={g}
        finding={g.findings[0]!}
        remaining={2}
        total={2}
        position={1}
        acceptDisabled={false}
        {...h}
        {...overrides}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const actions = dialog.querySelector(".tf-finding-overlay-actions") as HTMLElement;
    return { ...result, dialog, actions, group: g, handlers: h };
  }

  it("renders the finding with remaining count and navigation", () => {
    const { dialog } = renderInDialog();

    expect(within(dialog).getByText(/2 remaining/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /previous finding/i })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /next finding/i })).toBeEnabled();
  });

  it("calls onAccept when Accept is pressed", async () => {
    const { actions, handlers: h, group: g } = renderInDialog();

    await userEvent.click(within(actions).getByRole("button", { name: "Accept" }));
    expect(h.onAccept).toHaveBeenCalledWith(g.findings[0]);
  });

  it("calls onAcceptAll with the group when Accept all of this type is pressed", async () => {
    const { actions, handlers: h, group: g } = renderInDialog();

    await userEvent.click(within(actions).getByRole("button", { name: "Accept all of this type" }));
    expect(h.onAcceptAll).toHaveBeenCalledWith(g);
  });

  it("disables Accept and Accept all when coverage is incomplete", () => {
    const { actions } = renderInDialog({
      acceptDisabled: true,
      acceptDisabledReason: "Coverage is incomplete",
    });

    expect(within(actions).getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(within(actions).getByRole("button", { name: "Accept all of this type" })).toBeDisabled();
  });

  it("does not repeat Skip or Ignore in the action bar", () => {
    const { dialog } = renderInDialog();

    // These were removed from the bottom action bar: a second Skip/Ignore
    // under Accept offered the same action twice in one panel. The per-finding
    // controls (rendered inline by FindingDetail beside Go to text) still have them.
    const actions = dialog.querySelector(".tf-finding-overlay-actions") as HTMLElement;
    expect(within(actions).queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    expect(within(actions).queryByRole("button", { name: "Ignore" })).not.toBeInTheDocument();
  });

  it("still renders Skip and Ignore inline beside Go to text", () => {
    const { dialog } = renderInDialog();

    // FindingDetail renders these beside Go to text, not in the bottom action bar.
    expect(within(dialog).getByRole("button", { name: "Go to text" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Ignore" })).toBeInTheDocument();
  });

  it("keeps the count and the arrows together beside the title", () => {
    const { dialog } = renderInDialog();
    const side = dialog.querySelector(".tf-finding-overlay-header-side") as HTMLElement;

    expect(side).not.toBeNull();
    expect(within(side).getByText(/2 remaining/)).toBeInTheDocument();
    expect(within(side).getByRole("button", { name: /previous finding/i })).toBeInTheDocument();
    expect(within(side).getByRole("button", { name: /next finding/i })).toBeInTheDocument();
  });

  it("renders Restore instead of Accept when showing ignored findings", async () => {
    const {
      actions,
      handlers: h,
      group: g,
    } = renderInDialog({
      remaining: 0,
      isIgnored: true,
    });

    expect(within(actions).queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(
      within(actions).queryByRole("button", { name: "Accept all of this type" }),
    ).not.toBeInTheDocument();
    const restore = within(actions).getByRole("button", { name: "Restore" });
    expect(restore).toBeInTheDocument();
    await userEvent.click(restore);
    expect(h.onRestore).toHaveBeenCalledWith(g.findings[0]);
  });

  it("renders the apply result beside the action that produced it", () => {
    const { dialog } = renderInDialog({ applyNote: "Change applied." });

    const note = dialog.querySelector(".tf-finding-overlay-note");
    expect(note).not.toBeNull();
    expect(note).toHaveTextContent("Change applied.");
  });

  it("names a refused apply with its reason, not a generic failure", () => {
    const { dialog } = renderInDialog({
      applyNote: "Cannot apply: the document moved. Re-scan before applying.",
    });

    const note = dialog.querySelector(".tf-finding-overlay-note");
    expect(note).not.toBeNull();
    expect(note).toHaveTextContent("Cannot apply: the document moved. Re-scan before applying.");
  });

  it("shows no note before anything has been applied", () => {
    const { dialog } = renderInDialog();

    expect(dialog.querySelector(".tf-finding-overlay-note")).toBeNull();
  });
});
