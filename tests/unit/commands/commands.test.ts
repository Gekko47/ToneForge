import { afterEach, describe, expect, it, vi } from "vitest";
import {
  associateCommandActions,
  COMMAND_REGISTRY,
  duplicateNavigationTargets,
  openFindings,
  openPendingChanges,
  openProfile,
  openTroubleshooting,
  reviewForConsistency,
  scanNow,
} from "../../../src/commands/commands";
import { consumeTaskpaneTarget } from "../../../src/shared/office/taskpaneNavigation";

function setOffice(value: unknown): void {
  (globalThis as { Office?: unknown }).Office = value;
}

describe("command entry points", () => {
  afterEach(() => {
    setOffice(undefined);
    vi.restoreAllMocks();
  });

  it("does nothing when the Office action registry is unavailable", () => {
    setOffice({});
    expect(() => associateCommandActions()).not.toThrow();
  });

  it("associates every typed registry command and completes events", async () => {
    const associate = vi.fn();
    setOffice({ actions: { associate } });
    associateCommandActions();
    expect(associate).toHaveBeenCalledTimes(COMMAND_REGISTRY.length);
    expect(associate.mock.calls.map(([id]) => id)).toEqual(COMMAND_REGISTRY.map(({ id }) => id));
    const scan = associate.mock.calls.find(([id]) => id === "ToneForgeScan");
    const handler = scan?.[1] as (event: { completed: () => void }) => Promise<void>;
    const completed = vi.fn();
    await handler({ completed });
    expect(completed).toHaveBeenCalledOnce();
  });

  it("keeps registry destinations and manifest action kinds explicit", () => {
    expect(
      COMMAND_REGISTRY.map(({ id, label, jsonAction, xmlAction, navigationTarget }) => ({
        id,
        label,
        jsonAction,
        xmlAction,
        navigationTarget,
      })),
    ).toEqual([
      {
        id: "ToneForgeScan",
        label: "Scan Now",
        jsonAction: "executeFunction",
        xmlAction: "ShowTaskpane",
        navigationTarget: "governance",
      },
      {
        id: "ToneForgeFindings",
        label: "Findings",
        jsonAction: "executeFunction",
        xmlAction: "ShowTaskpane",
        navigationTarget: "findings",
      },
      {
        id: "ToneForgeReview",
        label: "Review for Consistency",
        jsonAction: "executeFunction",
        xmlAction: "ShowTaskpane",
        navigationTarget: "ai-review",
      },
      {
        id: "ToneForgeProfile",
        label: "Style Profile",
        jsonAction: "executeFunction",
        xmlAction: "ShowTaskpane",
        navigationTarget: "profile",
      },
      {
        id: "ToneForgeGovernancePolicy",
        label: "Governance Policy",
        jsonAction: "executeFunction",
        xmlAction: "ShowTaskpane",
        navigationTarget: "governance-policy",
      },
      {
        id: "ToneForgePendingChanges",
        label: "Pending Changes",
        jsonAction: "executeFunction",
        xmlAction: "ShowTaskpane",
        navigationTarget: "pending-changes",
      },
      {
        id: "ToneForgeTroubleshooting",
        label: "Troubleshooting",
        jsonAction: "executeFunction",
        xmlAction: "ShowTaskpane",
        navigationTarget: "debugging",
      },
    ]);
  });

  /**
   * Two ribbon buttons that open the same page are indistinguishable and
   * misleading about what the add-in can do. "Active Profile" and "Edit
   * Profile" both opened the profile page; "Review Selection" and "Review
   * Document" both opened a whole-document review that ignores the selection.
   */
  it("gives every command a distinct destination", () => {
    expect(duplicateNavigationTargets()).toEqual([]);
  });

  it("opens the requested task-pane destinations", async () => {
    const showAsTaskpane = vi.fn().mockResolvedValue(undefined);
    setOffice({ addin: { showAsTaskpane } });
    await openFindings();
    expect(consumeTaskpaneTarget()).toEqual({ target: "findings" });
    await reviewForConsistency();
    expect(consumeTaskpaneTarget()).toEqual({ target: "ai-review" });
    await openProfile();
    expect(consumeTaskpaneTarget()).toEqual({ target: "profile" });
    await openPendingChanges();
    expect(consumeTaskpaneTarget()).toEqual({ target: "pending-changes" });
    await openTroubleshooting();
    expect(consumeTaskpaneTarget()).toEqual({ target: "debugging" });
    expect(showAsTaskpane).toHaveBeenCalledTimes(5);
  });

  /**
   * "Scan Now" used to open the governance page and stop, so pressing a button
   * with that label got a page and required a second press to actually scan.
   */
  it("asks the pane to scan, not merely to open, for Scan Now", async () => {
    setOffice({ addin: { showAsTaskpane: vi.fn().mockResolvedValue(undefined) } });
    await scanNow();
    expect(consumeTaskpaneTarget()).toEqual({ target: "governance", action: "scan" });
  });

  it("falls back safely when Office is unavailable", async () => {
    setOffice(undefined);
    await reviewForConsistency();
    // The destination is still recorded, so the pane opens on AI Review when the
    // host eventually provides it rather than losing the user's intent.
    expect(consumeTaskpaneTarget()).toEqual({ target: "ai-review" });
  });

  it("registers the command actions when Office becomes ready", async () => {
    const onReady = vi.fn();
    setOffice({ onReady });
    vi.resetModules();
    await import("../../../src/commands/commands");
    expect(onReady).toHaveBeenCalledOnce();
  });
});
