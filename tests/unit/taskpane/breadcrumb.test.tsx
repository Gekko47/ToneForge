import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Breadcrumb } from "../../../src/taskpane/shell";
import { renderWithFluent, resetGriffelStyles } from "../../helpers/fluentV9";

/**
 * The breadcrumb control (ADR-0137).
 *
 * Its label is derived from the parent route's entry in `ROUTES`, so the control
 * cannot say one page and navigate to another. These tests pin that derivation:
 * the visible name is "Back to <parent label>", and the root renders nothing.
 */
describe("Breadcrumb", () => {
  it("derives its label from the parent route", () => {
    renderWithFluent(<Breadcrumb parent="review" onBack={() => undefined} />);
    expect(
      screen.getByRole("button", { name: "Back to Deterministic Review" }),
    ).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("reads Back to Home for the root's parent", () => {
    renderWithFluent(<Breadcrumb parent="landing" onBack={() => undefined} />);
    expect(screen.getByRole("button", { name: "Back to Home" })).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("renders nothing when there is no parent", () => {
    renderWithFluent(<Breadcrumb parent={null} onBack={() => undefined} />);
    expect(screen.queryByRole("button")).toBeNull();
    resetGriffelStyles();
  });

  it("is a breadcrumb landmark", () => {
    renderWithFluent(<Breadcrumb parent="landing" onBack={() => undefined} />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    resetGriffelStyles();
  });
});
