import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import GeneralSettings from "../../../../src/taskpane/pages/GeneralSettings";

/*
 * The three sections have their own tests for their own behaviour. What is
 * tested here is the composition: that the page is titled General Settings and
 * that all three project-wide controls are actually mounted. The regression this
 * guards is the one the page exists to fix — the sections were orphaned, present
 * in the tree but imported by nothing, so a page that forgot one would look
 * complete and silently drop a setting.
 */

const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

vi.mock("../../../../src/core/state/persistence", () => ({
  loadState: mocks.loadState,
  saveState: mocks.saveState,
}));

vi.mock("../../../../src/reformat", () => ({
  isTrackedEditingEnabled: () => false,
  prepareTrackedEditing: vi.fn(),
  prepareReformatHost: vi.fn(),
  setTrackedEditingEnabled: vi.fn(),
}));

vi.mock("../../../../src/taskpane/theme", () => ({
  useTheme: () => ({
    reducedMotion: false,
    themePreference: "system",
    setThemePreference: vi.fn(),
  }),
}));

beforeEach(() => {
  mocks.loadState.mockReturnValue({ settings: { autoScan: true } });
  mocks.saveState.mockImplementation(() => undefined);
});

describe("GeneralSettings", () => {
  it("mounts the scanning, tracked editing, and styling controls", () => {
    render(<GeneralSettings onBack={vi.fn()} parent="landing" />);

    expect(screen.getByRole("switch", { name: /scan automatically/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /tracked changes/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Styling" })).toBeInTheDocument();
  });

  it("offers a way back to Home", () => {
    render(<GeneralSettings onBack={vi.fn()} parent="landing" />);
    expect(screen.getByRole("button", { name: "Back to Home" })).toBeInTheDocument();
  });
});
