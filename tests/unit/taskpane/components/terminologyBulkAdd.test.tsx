/**
 * The bulk-add disclosure — the DOM half of bulk terminology creation.
 *
 * The decisions (what gets added, what gets skipped, which id each rule takes)
 * live in `terminologyRows` and are tested there without rendering. What is left
 * here is only what the DOM adds: that the count is stated before anything is
 * written, that a skip is visible rather than silent, and that Apply cannot fire
 * when there is nothing to apply.
 */

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import TerminologyBulkAdd from "../../../../src/taskpane/components/TerminologyBulkAdd";
import type { TerminologyRule } from "../../../../src/core/domain/StyleProfile";

function rule(overrides: Partial<TerminologyRule> & { id: string }): TerminologyRule {
  return {
    source: "term",
    replacement: "term",
    caseSensitive: false,
    wholeWord: true,
    severity: "advisory",
    scope: {},
    ...overrides,
  };
}

function Harness({
  existing = [],
  onAdd = vi.fn(),
}: {
  existing?: TerminologyRule[];
  onAdd?: (rules: TerminologyRule[]) => void;
}): React.ReactNode {
  return <TerminologyBulkAdd id="bulk" existing={existing} onAdd={onAdd} />;
}

/**
 * Renders with the disclosure already open.
 *
 * Required for any assertion on the *contents*: a closed `<details>` hides them
 * from the accessibility tree, so `getByRole` cannot see them. That is the
 * behaviour we want — a screen-reader user reaches the paste box by opening the
 * disclosure — and the tests have to open it the same way a user would.
 */
function renderOpened(
  existing: TerminologyRule[] = [],
  onAdd: (rules: TerminologyRule[]) => void = vi.fn(),
): HTMLElement {
  const { container } = render(<Harness existing={existing} onAdd={onAdd} />);
  const details = container.querySelector("details");
  if (details === null) throw new Error("bulk-add did not render a disclosure");
  details.open = true;
  return container;
}

function paste(text: string): void {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
}

describe("TerminologyBulkAdd", () => {
  it("states what a paste would add before anything is written", () => {
    /*
     * The count is the whole reason this is not a one-shot button. A paste of two
     * hundred lines is something a user should agree to.
     */
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} />);
    paste("colour: color\nprioritise: prioritize");

    expect(screen.getByText("2 terms would be added.")).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("says nothing would be added when everything is already present", () => {
    render(<Harness existing={[rule({ id: "term-1", source: "colour" })]} />);
    paste("colour: color");

    expect(screen.getByText(/0 terms would be added\./)).toBeInTheDocument();
    expect(screen.getByText(/1 is already in the list/)).toBeInTheDocument();
  });

  it("says so rather than showing a live button when there is nothing to add", () => {
    // A disabled-looking control next to "0 terms" still reads as broken.
    render(<Harness existing={[rule({ id: "term-1", source: "colour" })]} />);
    paste("colour: color");
    expect(screen.getByRole("button", { name: "Add 0 terms" })).toBeDisabled();
  });

  it("adds every pasted pair when Apply is pressed", () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} />);
    paste("colour: color\nprioritise: prioritize");
    fireEvent.click(screen.getByRole("button", { name: "Add 2 terms" }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const added = onAdd.mock.calls[0]?.[0] as TerminologyRule[];
    expect(added.map((entry) => entry.source)).toEqual(["colour", "prioritise"]);
    expect(added.map((entry) => entry.replacement)).toEqual(["color", "prioritize"]);
  });

  it("names the lines it would skip, so a silent drop is impossible", () => {
    renderOpened([rule({ id: "term-1", source: "colour" })]);
    paste("colour: color\nprioritise: prioritize");
    // Scoped to the list: the summary above says the same thing in a sentence,
    // and a test that matched either would pass even if the per-line detail —
    // the part that tells the user *which* line — were gone.
    const skipped = screen.getByRole("list", { name: "Lines that would be skipped" });
    expect(within(skipped).getByText("colour")).toBeInTheDocument();
    expect(within(skipped).getByText(/already in the list/)).toBeInTheDocument();
  });

  it("refuses a malformed line and does not offer to apply", () => {
    /*
     * Refused whole, rather than applied partially. A paste where one line is
     * unusable is more likely a formatting mistake than a deliberate exclusion,
     * and applying the rest silently would hide the mistake.
     */
    render(<Harness />);
    paste("colour");
    expect(screen.getByRole("button", { name: /Add/ })).toBeDisabled();
  });

  it("clears the box after applying, so Apply cannot be pressed twice", () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} />);
    paste("colour: color");
    fireEvent.click(screen.getByRole("button", { name: "Add 1 term" }));

    expect(screen.getByRole("textbox")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Add 0 terms" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("is a disclosure, so the paste box is not permanently in the way", () => {
    // Forty terminology rows would bury an always-open textarea in a 329px pane.
    const container = renderOpened();
    expect(container.querySelector("details.tf-bulk-add")).not.toBeNull();
    expect(screen.getByText("Add many terms")).toBeInTheDocument();
  });

  it("announces the count politely, because it changes as the user types", () => {
    render(<Harness />);
    paste("colour: color");
    expect(screen.getByRole("status")).toHaveTextContent("1 term would be added.");
  });

  it("prompts rather than showing a zero when the box is empty", () => {
    render(<Harness />);
    expect(screen.getByRole("status")).toHaveTextContent("Paste some lines");
  });
});
