import { afterEach, describe, expect, it, vi } from "vitest";
import {
  associateCommandActions,
  COMMAND_REGISTRY,
  openFindings,
  openPendingChanges,
  reviewDocument,
  reviewSelection,
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
        id: "ToneForgeReviewSelection",
        label: "Review Selection",
        jsonAction: "executeFunction",
        xmlAction: "ShowTaskpane",
        navigationTarget: "ai-review-selection",
      },
      {
        id: "ToneForgeReviewDocument",
        label: "Review Document",
        jsonAction: "executeFunction",
        xmlAction: "ShowTaskpane",
        navigationTarget: "ai-review-document",
      },
      {
        id: "ToneForgeActiveProfile",
        label: "Active Profile",
        jsonAction: "executeFunction",
        xmlAction: "ShowTaskpane",
        navigationTarget: "profile",
      },
      {
        id: "ToneForgeEditProfile",
        label: "Edit Profile",
        jsonAction: "executeFunction",
        xmlAction: "ShowTaskpane",
        navigationTarget: "profile",
      },
      {
        id: "ToneForgePendingChanges",
        label: "Pending Changes",
        jsonAction: "executeFunction",
        xmlAction: "ShowTaskpane",
        navigationTarget: "pending-changes",
      },
    ]);
  });

  it("opens the requested task-pane destinations", async () => {
    const showAsTaskpane = vi.fn().mockResolvedValue(undefined);
    setOffice({ addin: { showAsTaskpane } });
    await scanNow();
    expect(consumeTaskpaneTarget()).toBe("governance");
    await openFindings();
    expect(consumeTaskpaneTarget()).toBe("findings");
    await reviewDocument();
    expect(consumeTaskpaneTarget()).toBe("ai-review-document");
    await openPendingChanges();
    expect(consumeTaskpaneTarget()).toBe("pending-changes");
    expect(showAsTaskpane).toHaveBeenCalledTimes(4);
  });

  it("falls back safely when Office is unavailable", async () => {
    setOffice(undefined);
    await reviewSelection();
    expect(consumeTaskpaneTarget()).toBe("governance");
  });

  it("registers the command actions when Office becomes ready", async () => {
    const onReady = vi.fn();
    setOffice({ onReady });
    vi.resetModules();
    await import("../../../src/commands/commands");
    expect(onReady).toHaveBeenCalledOnce();
  });
});
