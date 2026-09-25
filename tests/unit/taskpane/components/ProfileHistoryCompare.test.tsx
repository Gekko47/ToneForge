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
  it("shows readable field changes side by side with technical diff disclosure", () => {
    render(<ProfileHistoryCompare left={base} right={changed} leftLabel="v1" rightLabel="v2" />);
    expect(screen.getByRole("region", { name: "Profile history comparison" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "v1" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "v2" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Profile name" })).toBeInTheDocument();
    expect(screen.getByText("Org v2")).toBeInTheDocument();
    expect(screen.getByText("Technical field diff")).toBeInTheDocument();
  });

  it("reports equivalence when nothing changed", () => {
    render(<ProfileHistoryCompare left={base} right={base} leftLabel="v1" rightLabel="v2" />);
    expect(screen.getByText("These versions are equivalent.")).toBeInTheDocument();
  });
});
