import { describe, expect, it } from "vitest";
import {
  consumeTaskpaneTarget,
  setTaskpaneTarget,
  subscribeToTaskpaneTarget,
  TASKPANE_NAVIGATION_KEY,
} from "../../../../src/shared/office/taskpaneNavigation";

describe("taskpane navigation instructions", () => {
  it("round-trips the semantic-review destination with its read-selection action", () => {
    // The context-menu path. Dropping the action here would mean the pane opens
    // on Semantic Review with nothing selected, and the user has to select the
    // same text again after already right-clicking it.
    setTaskpaneTarget("semantic-review", "read-selection");
    expect(consumeTaskpaneTarget()).toEqual({
      target: "semantic-review",
      action: "read-selection",
    });
  });

  it("carries no action for an ordinary open", () => {
    // An action must be something the command asked for, never a default. A
    // destination that always worked would let a plain "open this page" button
    // start work the user never requested.
    setTaskpaneTarget("semantic-review");
    expect(consumeTaskpaneTarget()).toEqual({ target: "semantic-review" });
  });

  it("drops the retired `semantic` target rather than guessing what it meant", () => {
    // Renamed in P9. The instruction lives in storage for the length of one
    // pane session, so the only value that can be stale is one written by a
    // build that has just been replaced — and guessing is worse than dropping:
    // a bare "semantic" could mean either of the two pages, and sending it to
    // the wrong one is a silent wrong answer rather than an obvious no-op.
    window.localStorage.setItem(TASKPANE_NAVIGATION_KEY, JSON.stringify({ target: "semantic" }));
    expect(consumeTaskpaneTarget()).toBeNull();
  });

  it("keeps the scan action working, so the second action did not displace it", () => {
    setTaskpaneTarget("review", "scan");
    expect(consumeTaskpaneTarget()).toEqual({ target: "review", action: "scan" });
  });

  /**
   * A command used while the pane is already open.
   *
   * `consumeTaskpaneTarget` was the only reader, and it ran once on mount, so a
   * ribbon or context-menu command used afterwards wrote its instruction and
   * nothing read it. The button did nothing, silently, and the next mount picked
   * up a stale instruction from whenever the user reopened the pane. The
   * commands run in a different document, which is the case `storage` events
   * exist for.
   */
  it("delivers a command that arrives after mount", () => {
    const seen: unknown[] = [];
    const unsubscribe = subscribeToTaskpaneTarget((navigation) => seen.push(navigation));
    try {
      // Written by the "other document", then announced. The event carries the
      // key, which the listener checks before consuming.
      setTaskpaneTarget("findings");
      window.dispatchEvent(
        new StorageEvent("storage", { key: TASKPANE_NAVIGATION_KEY, newValue: "{}" }),
      );
      expect(seen).toEqual([{ target: "findings" }]);
      // Consumed, so the same instruction cannot re-fire on the next mount.
      expect(consumeTaskpaneTarget()).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it("ignores a storage event for an unrelated key", () => {
    const seen: unknown[] = [];
    const unsubscribe = subscribeToTaskpaneTarget((navigation) => seen.push(navigation));
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: "SomeOtherKey" }));
      expect(seen).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it("drops an action it does not recognise rather than passing it on", () => {
    // The value is read back from storage, which is not a trusted boundary. An
    // unknown action must not reach a page that would have to guess what it
    // means.
    window.localStorage.setItem(
      TASKPANE_NAVIGATION_KEY,
      JSON.stringify({ target: "semantic-review", action: "delete-document" }),
    );
    expect(consumeTaskpaneTarget()).toEqual({ target: "semantic-review" });
  });

  it("consumes the instruction once, so a stale one cannot re-fire later", () => {
    setTaskpaneTarget("semantic-review", "read-selection");
    expect(consumeTaskpaneTarget()).not.toBeNull();
    expect(consumeTaskpaneTarget()).toBeNull();
  });
});
