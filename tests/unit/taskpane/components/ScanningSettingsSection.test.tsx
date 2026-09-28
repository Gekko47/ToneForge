import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScanningSettingsSection, {
  AUTO_SCAN_OFF_NOTE,
} from "../../../../src/taskpane/components/ScanningSettingsSection";

const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

vi.mock("../../../../src/core/state/persistence", () => ({
  loadState: mocks.loadState,
  saveState: mocks.saveState,
}));

function stateWith(autoScan: boolean) {
  return { settings: { autoScan } };
}

beforeEach(() => {
  mocks.saveState.mockImplementation(() => undefined);
});

describe("ScanningSettingsSection", () => {
  it("shows the stored preference rather than assuming the default", () => {
    // A stored `false` is a real choice the user made. Rendering `true`
    // regardless would quietly re-enable scanning for someone who turned it
    // off, on the first visit to Settings after the change.
    mocks.loadState.mockReturnValue(stateWith(false));
    render(<ScanningSettingsSection />);

    expect(screen.getByRole("switch", { name: /scan automatically/i })).not.toBeChecked();
  });

  it("persists the change the user made", async () => {
    mocks.loadState.mockReturnValue(stateWith(true));
    render(<ScanningSettingsSection />);

    await userEvent.click(screen.getByRole("switch", { name: /scan automatically/i }));
    await userEvent.click(screen.getByRole("button", { name: /save scanning/i }));

    expect(mocks.saveState).toHaveBeenCalledTimes(1);
    expect(mocks.saveState.mock.calls[0]?.[0]).toMatchObject({ settings: { autoScan: false } });
  });

  it("offers nothing to save when the stored preference has not changed", () => {
    // A stored `false` is a real choice. Writing the schema default back over it
    // would switch scanning on again for someone who deliberately turned it
    // off, so an unchanged section must not offer a save at all.
    mocks.loadState.mockReturnValue(stateWith(false));
    render(<ScanningSettingsSection />);

    expect(screen.getByRole("button", { name: /save scanning/i })).toBeDisabled();
    expect(mocks.saveState).not.toHaveBeenCalled();
  });

  it("discards an unsaved change on cancel", async () => {
    mocks.loadState.mockReturnValue(stateWith(true));
    render(<ScanningSettingsSection />);

    const toggle = screen.getByRole("switch", { name: /scan automatically/i });
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(toggle).toBeChecked();
    expect(mocks.saveState).not.toHaveBeenCalled();
  });

  it("says the manual scan still works, so turning this off is not a dead end", async () => {
    // The obvious fear when switching this off is that it disables ToneForge.
    // It does not, and the section has to say so where the decision is made
    // rather than only in documentation.
    mocks.loadState.mockReturnValue(stateWith(true));
    render(<ScanningSettingsSection />);

    expect(screen.queryByText(/stop scanning as you type/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch", { name: /scan automatically/i }));
    expect(screen.getByText(/stop scanning as you type/i)).toBeInTheDocument();
    expect(screen.getByText(/re-scan now/i)).toBeInTheDocument();
    expect(AUTO_SCAN_OFF_NOTE).toMatch(/still works/i);
  });
});
