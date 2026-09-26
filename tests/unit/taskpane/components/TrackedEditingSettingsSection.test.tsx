import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TrackedEditingSettingsSection from "../../../../src/taskpane/components/TrackedEditingSettingsSection";

const prepareTrackedEditing = vi.fn();
const prepareReformatHost = vi.fn();
const STORAGE_KEY = "ToneForge.TrackedEditingEnabled";

vi.mock("../../../../src/reformat", () => ({
  isTrackedEditingEnabled: () => false,
  prepareTrackedEditing: (...args: unknown[]) => prepareTrackedEditing(...args),
  prepareReformatHost: (...args: unknown[]) => prepareReformatHost(...args),
  setTrackedEditingEnabled: (enabled: boolean) => {
    window.localStorage.setItem("ToneForge.TrackedEditingEnabled", String(enabled));
  },
}));

function switchControl(): HTMLElement {
  return screen.getByRole("switch", { name: /tracked changes/i });
}

async function setup(): Promise<ReturnType<typeof userEvent.setup>> {
  render(<TrackedEditingSettingsSection />);
  return userEvent.setup();
}

describe("TrackedEditingSettingsSection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    prepareTrackedEditing.mockReset();
    prepareReformatHost.mockReset();
  });

  it("persists the enable before probing, so the gate does not refuse itself", async () => {
    const user = await setup();
    // The regression: the enable path called `prepareTrackedEditing` without
    // writing the flag first, so the preparation re-read `false`, refused, and
    // the toggle snapped straight back off.
    prepareTrackedEditing.mockImplementation(async () => {
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");
      return { enabled: true, capabilities: null, unsupportedChangeIds: [], error: null };
    });

    await user.click(switchControl());

    await waitFor(() => {
      expect(switchControl()).toBeChecked();
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("reverts and explains when the host refuses the revision capability", async () => {
    const user = await setup();
    prepareTrackedEditing.mockResolvedValue({
      enabled: true,
      capabilities: { supportsRevisions: false },
      unsupportedChangeIds: [],
      error: "This Word host does not expose the revision capability required for tracked editing.",
    });

    await user.click(switchControl());

    await waitFor(() => {
      expect(switchControl()).not.toBeChecked();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      /does not expose the revision capability/i,
    );
  });

  it("disarms immediately when switched off", async () => {
    const user = await setup();
    prepareTrackedEditing.mockResolvedValue({
      enabled: true,
      capabilities: null,
      unsupportedChangeIds: [],
      error: null,
    });
    await user.click(switchControl());
    await waitFor(() => {
      expect(switchControl()).toBeChecked();
    });

    await user.click(switchControl());
    await waitFor(() => {
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("false");
    });
  });
});
