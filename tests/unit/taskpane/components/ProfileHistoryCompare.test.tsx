import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ProfileHistoryCompare from "../../../../src/taskpane/components/ProfileHistoryCompare";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";

const base = createEmptyProfile("Org");
const changed = {
  ...base,
  name: "Org v2",
  typography: { ...base.typography, emDash: "hyphen" as const },
};

describe("ProfileHistoryCompare", () => {
  it("shows readable field changes as a card list with technical diff disclosure", () => {
    render(<ProfileHistoryCompare left={base} right={changed} leftLabel="v1" rightLabel="v2" />);
    expect(screen.getByRole("region", { name: "Profile history comparison" })).toBeInTheDocument();
    // The comparison is a card list, not a table (plan §2.3/§33): a three-column
    // table in a 320px pane is one word per cell and scrolls sideways.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Profile name" })).toBeInTheDocument();
    // Each card repeats the two column labels, so they appear once per change.
    expect(screen.getAllByText("v1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("v2").length).toBeGreaterThan(0);
    expect(screen.getByText("Org v2")).toBeInTheDocument();
    expect(screen.getByText("Technical field diff")).toBeInTheDocument();
  });

  it("reports equivalence when nothing changed", () => {
    render(<ProfileHistoryCompare left={base} right={base} leftLabel="v1" rightLabel="v2" />);
    expect(screen.getByText("These versions are equivalent.")).toBeInTheDocument();
  });
});
