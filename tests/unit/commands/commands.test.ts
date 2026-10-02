import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  associateCommandActions,
  COMMAND_REGISTRY,
  duplicateNavigationTargets,
  openFindings,
  openPendingChanges,
  openProfile,
  openSemanticReview,
  openTroubleshooting,
  reviewForConsistency,
  scanNow,
  ToneForgeSemantic,
} from "../../../src/commands/commands";
import { consumeTaskpaneTarget } from "../../../src/shared/office/taskpaneNavigation";

function setOffice(value: unknown): void {
  (globalThis as { Office?: unknown }).Office = value;
}

describe("command entry points", () => {
  /*
   * The bridge holds its instruction in module state as well as in storage, so a
   * command's instruction would otherwise leak into the next test and be consumed
   * by the wrong assertion.
   */
  beforeEach(() => {
    window.localStorage.clear();
    consumeTaskpaneTarget();
  });

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
        xmlAction: "ExecuteFunction",
        navigationTarget: "review",
      },
      {
        id: "ToneForgeFindings",
        label: "Findings",
        jsonAction: "executeFunction",
        xmlAction: "ExecuteFunction",
        navigationTarget: "findings",
      },
      {
        id: "ToneForgeReview",
        label: "Review for Consistency",
        jsonAction: "executeFunction",
        xmlAction: "ExecuteFunction",
        navigationTarget: "ai-review",
      },
      {
        id: "ToneForgeProfile",
        label: "Style Profile",
        jsonAction: "executeFunction",
        xmlAction: "ExecuteFunction",
        navigationTarget: "profile",
      },
      {
        id: "ToneForgeGovernancePolicy",
        label: "Governance Policy",
        jsonAction: "executeFunction",
        xmlAction: "ExecuteFunction",
        navigationTarget: "governance-policy",
      },
      {
        id: "ToneForgePendingChanges",
        label: "Pending Changes",
        jsonAction: "executeFunction",
        xmlAction: "ExecuteFunction",
        navigationTarget: "pending-changes",
      },
      {
        id: "ToneForgeTroubleshooting",
        label: "Troubleshooting",
        jsonAction: "executeFunction",
        xmlAction: "ExecuteFunction",
        navigationTarget: "debugging",
      },
      {
        // Relabelled in P9. "Check Semantic Style" named the style page, and the
        // command opens the review; the label followed the page rather than the
        // action, so a user pressing it got somewhere the label did not describe.
        id: "ToneForgeSemantic",
        label: "Semantic Review",
        jsonAction: "executeFunction",
        xmlAction: "ExecuteFunction",
        navigationTarget: "semantic-review",
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
  });

  /*
   * The assertion that would have caught the second pane.
   *
   * Every command used to call `Office.addin.showAsTaskpane()`, on the
   * assumption that it reveals the pane the user already has. In a real Word it
   * does not: the host opened a second window running `/commands.html` \u2014 the
   * shared runtime's own function file, which is blank. Its console identified
   * it, logging `syncSemanticRibbon` with `ControlIdNotFound`, a message only
   * `commands.ts` emits. So a function command opening a pane is not a degraded
   * result, it is a second pane \u2014 and ADR-0101 and ADR-0104 are both right that
   * this add-in must have exactly one.
   *
   * Not one call, for any command, whatever the pane is doing.
   */
  it("never opens a pane from a function command", async () => {
    const showAsTaskpane = vi.fn().mockResolvedValue(undefined);
    setOffice({ addin: { showAsTaskpane } });

    await openFindings();
    await reviewForConsistency();
    await openProfile();
    await openPendingChanges();
    await openTroubleshooting();
    await openSemanticReview();
    await scanNow();
    await ToneForgeSemantic();

    expect(showAsTaskpane).not.toHaveBeenCalled();
  });

  /**
   * The context-menu entry point. The user right-clicked one specific piece of
   * text, so the instruction carries that read with it — otherwise the gesture
   * that brought them to the pane has to be repeated by hand.
   */
  it("asks the pane to read the selection for the semantic command", async () => {
    setOffice({ addin: { showAsTaskpane: vi.fn().mockResolvedValue(undefined) } });
    await openSemanticReview();
    expect(consumeTaskpaneTarget()).toEqual({
      target: "semantic-review",
      action: "read-selection",
    });
  });

  it("resolves the XML manifest's onAction name to the same destination", async () => {
    // The XML manifest resolves `onAction` against a global, not against the
    // JSON action registry, so this alias has to reach the same place. If the
    // two manifests could open different pages, sideloading one of them would
    // silently ship a different product.
    setOffice({ addin: { showAsTaskpane: vi.fn().mockResolvedValue(undefined) } });
    await ToneForgeSemantic();
    expect(consumeTaskpaneTarget()).toEqual({
      target: "semantic-review",
      action: "read-selection",
    });
  });

  /**
   * "Scan Now" used to open the governance page and stop, so pressing a button
   * with that label got a page and required a second press to actually scan.
   */
  it("asks the pane to scan, not merely to open, for Scan Now", async () => {
    setOffice({ addin: { showAsTaskpane: vi.fn().mockResolvedValue(undefined) } });
    await scanNow();
    expect(consumeTaskpaneTarget()).toEqual({ target: "review", action: "scan" });
  });

  it("falls back safely when Office is unavailable", async () => {
    setOffice(undefined);
    await reviewForConsistency();
    // The destination is still recorded, so the pane opens on AI Review when the
    // host eventually provides it rather than losing the user's intent.
    expect(consumeTaskpaneTarget()).toEqual({ target: "ai-review" });
  });

  /*
   * The failure a real Word produced: "Tracking Prevention blocked access to
   * storage for <URL>". `setItem` went nowhere while `showAsTaskpane()` opened a
   * pane regardless, so the user got a blank second window and no selection.
   *
   * The pane is still opened \u2014 the user's requirement is "the current pane, or a
   * working new one" \u2014 but the instruction no longer depends on storage being
   * available, and the fallback is logged rather than silent. A blank window is
   * now a host limitation with a named cause, not the default behaviour.
   */
  it("still directs the command when this host blocks storage", async () => {
    const showAsTaskpane = vi.fn().mockResolvedValue(undefined);
    setOffice({ addin: { showAsTaskpane } });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    await openSemanticReview();

    expect(consumeTaskpaneTarget()).toEqual({
      target: "semantic-review",
      action: "read-selection",
    });
    expect(showAsTaskpane).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("does not treat a silently discarded write as a delivery", async () => {
    /*
     * The harder version of the same host failure: `setItem` returns normally and
     * the value is simply not there. A check that only asserted "did not throw"
     * would pass on exactly the host that failed, so the value is read back and
     * compared \u2014 and the verdict comes from the routes that actually carried it.
     */
    const showAsTaskpane = vi.fn().mockResolvedValue(undefined);
    setOffice({ addin: { showAsTaskpane } });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => undefined);

    await openSemanticReview();

    expect(window.localStorage.getItem("ToneForge.TaskpaneNavigation")).toBeNull();
    expect(showAsTaskpane).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("registers the command actions when Office becomes ready", async () => {
    const onReady = vi.fn();
    setOffice({ onReady });
    vi.resetModules();
    await import("../../../src/commands/commands");
    expect(onReady).toHaveBeenCalledOnce();
  });
});
