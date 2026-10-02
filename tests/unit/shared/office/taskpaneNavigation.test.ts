import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeTaskpaneTarget,
  setTaskpaneTarget,
  subscribeToTaskpaneTarget,
  TASKPANE_NAVIGATION_KEY,
} from "../../../../src/shared/office/taskpaneNavigation";

describe("taskpane navigation instructions", () => {
  /*
   * A clean slate before every test, and the reason is worth stating.
   *
   * The bridge now holds the instruction in memory as well as in storage, so a
   * module variable outlives an individual test. That is correct in a host \u2014 one
   * document, one bridge \u2014 and it meant two tests here shared state: the second
   * consumed what the first had written, and both failed for a reason that had
   * nothing to do with either. A shared store needs its tests to declare their
   * starting state rather than inherit it.
   */
  beforeEach(() => {
    window.localStorage.clear();
    consumeTaskpaneTarget();
  });

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
  it("delivers a command over the live channel, without storage", async () => {
    /*
     * The route that survives this host.
     *
     * A real Word reported "Tracking Prevention blocked access to storage", so the
     * `storage` event above is a listener for something that could not happen
     * there, and a command written while the pane was already open reached
     * nobody. `BroadcastChannel` is same-origin and is not something a privacy
     * setting switches off, so this is the path that keeps the button working on
     * the host that broke the other one.
     *
     * Written from a **separate channel object**, because a `BroadcastChannel`
     * does not deliver to the channel that posted \u2014 and that is the mechanism
     * behind the two routes rather than an obstacle. Separate documents (the
     * commands runtime and the pane) hold separate channel objects, so the
     * channel delivers; a shared runtime puts both in one document, where the
     * module variable carries it instead. Neither arrangement needs the other.
     */
    const seen: unknown[] = [];
    const unsubscribe = subscribeToTaskpaneTarget((navigation) => seen.push(navigation));
    const otherDocument = new BroadcastChannel("ToneForge.TaskpaneNavigation.live");
    try {
      otherDocument.postMessage({ target: "findings" });
      // Broadcast delivery is asynchronous by specification, so the listener is
      // given a turn before the assertion rather than being raced.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(seen).toEqual([{ target: "findings" }]);
    } finally {
      otherDocument.close();
      unsubscribe();
    }
  });

  it("announces a command to an already-open pane without relying on storage", () => {
    // The publisher's own verdict. A host that blocks storage still gets the
    // instruction out over the live channel, and `setTaskpaneTarget` says so
    // rather than reporting a delivery it could not make \u2014 which is the check
    // that stops a blank pane being opened for an instruction nobody received.
    window.localStorage.clear();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => undefined);
    try {
      expect(setTaskpaneTarget("findings")).toBe(true);
    } finally {
      setItem.mockRestore();
    }
  });

  it("validates a live-channel message rather than casting it", async () => {
    /*
     * The channel is same-origin, which says where a message came from and
     * nothing about whether it is one of ours. A listener that cast whatever
     * arrived would let a foreign value reach the navigation mapping, which is
     * how a page ends up navigated by a string nobody wrote here.
     */
    const seen: unknown[] = [];
    const unsubscribe = subscribeToTaskpaneTarget((navigation) => seen.push(navigation));
    try {
      const channel = new BroadcastChannel("ToneForge.TaskpaneNavigation.live");
      channel.postMessage({ target: "semantic", action: "read-selection" });
      channel.postMessage({ target: "semantic-review", action: "delete-document" });
      channel.postMessage("not-an-object");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(seen).toEqual([{ target: "semantic-review" }]);
      channel.close();
    } finally {
      unsubscribe();
    }
  });

  it("delivers a command that arrives after mount", async () => {
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
