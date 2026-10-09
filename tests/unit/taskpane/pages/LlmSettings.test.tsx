import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import LlmSettings from "../../../../src/taskpane/pages/LlmSettings";

/*
 * The dashboard has its own test for its own behaviour. What is tested here is
 * the page shell: that it is titled LLM Settings and that it still renders the
 * dashboard body. The dashboard is stubbed so this test does not pull in the
 * gateway and provider machinery the page itself does not own.
 */

vi.mock("../../../../src/core/state/persistence", () => ({
  loadState: vi.fn(() => ({ settings: {} })),
  saveState: vi.fn(),
}));

vi.mock("../../../../src/taskpane/components/SettingsDashboard", () => ({
  SettingsDashboard: () => <div data-testid="settings-dashboard" />,
}));

describe("LlmSettings", () => {
  it("is titled LLM Settings", () => {
    render(<LlmSettings onBack={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "LLM Settings" })).toBeInTheDocument();
  });

  it("renders the LLM dashboard body", () => {
    render(<LlmSettings onBack={vi.fn()} />);
    expect(screen.getByTestId("settings-dashboard")).toBeInTheDocument();
  });

  it("offers a way back to Deterministic Review", () => {
    render(<LlmSettings onBack={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Back to Deterministic Review" }),
    ).toBeInTheDocument();
  });
});
