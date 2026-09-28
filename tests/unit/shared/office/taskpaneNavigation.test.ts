import { describe, expect, it } from "vitest";
import {
  consumeTaskpaneTarget,
  setTaskpaneTarget,
  TASKPANE_NAVIGATION_KEY,
} from "../../../../src/shared/office/taskpaneNavigation";

describe("taskpane navigation instructions", () => {
  it("round-trips the semantic destination with its read-selection action", () => {
    // The context-menu path. Dropping the action here would mean the pane opens
    // on the Semantic tab with nothing selected, and the user has to select the
    // same text again after already right-clicking it.
    setTaskpaneTarget("semantic", "read-selection");
    expect(consumeTaskpaneTarget()).toEqual({ target: "semantic", action: "read-selection" });
  });

  it("carries no action for an ordinary open", () => {
    // An action must be something the command asked for, never a default. A
    // destination that always worked would let a plain "open this page" button
    // start work the user never requested.
    setTaskpaneTarget("semantic");
    expect(consumeTaskpaneTarget()).toEqual({ target: "semantic" });
  });

  it("keeps the scan action working, so the second action did not displace it", () => {
    setTaskpaneTarget("governance", "scan");
    expect(consumeTaskpaneTarget()).toEqual({ target: "governance", action: "scan" });
  });

  it("drops an action it does not recognise rather than passing it on", () => {
    // The value is read back from storage, which is not a trusted boundary. An
    // unknown action must not reach a page that would have to guess what it
    // means.
    window.localStorage.setItem(
      TASKPANE_NAVIGATION_KEY,
      JSON.stringify({ target: "semantic", action: "delete-document" }),
    );
    expect(consumeTaskpaneTarget()).toEqual({ target: "semantic" });
  });

  it("consumes the instruction once, so a stale one cannot re-fire later", () => {
    setTaskpaneTarget("semantic", "read-selection");
    expect(consumeTaskpaneTarget()).not.toBeNull();
    expect(consumeTaskpaneTarget()).toBeNull();
  });
});
