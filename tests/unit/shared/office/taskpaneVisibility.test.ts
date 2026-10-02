/**
 * Task-pane visibility (ADR-0107, ADR-0108).
 *
 * The context menu is a **task pane command**, so no JavaScript of ours runs when
 * the user picks it. The pane's own visibility change is the only signal that
 * fires, and it is what tells an already-open pane it was summoned.
 *
 * Every case here is a host that could plausibly be the one reporting the bug,
 * so the module is tested against absence as carefully as against presence: a
 * subscription that throws, or that never appears, must leave the page working
 * rather than take it down.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { watchTaskpaneVisibility } from "../../../../src/shared/office/taskpaneVisibility";

function installOffice(addin: unknown): void {
  (globalThis as { Office?: unknown }).Office = addin === undefined ? {} : { addin };
}

describe("task-pane visibility", () => {
  afterEach(() => {
    (globalThis as { Office?: unknown }).Office = undefined;
    vi.restoreAllMocks();
  });

  it("reports there is nothing to watch on a host with no addin at all", async () => {
    // A host without a shared runtime has no `Office.addin`, and absence must be
    // an answer rather than a throw: the page still reads on mount.
    expect(await watchTaskpaneVisibility(() => undefined)).toBeNull();
  });

  it("reports nothing to watch when the host exposes no addin object", async () => {
    installOffice(undefined);
    expect(await watchTaskpaneVisibility(() => undefined)).toBeNull();
  });

  it("reports nothing to watch when the host exposes the object but not the event", async () => {
    installOffice({ showAsTaskpane: vi.fn() });
    expect(await watchTaskpaneVisibility(() => undefined)).toBeNull();
  });

  it("returns the host's own deregister handler, so teardown is the host's decision", async () => {
    const remove = vi.fn(async () => undefined);
    installOffice({ onVisibilityModeChanged: vi.fn(async () => remove) });

    const handler = await watchTaskpaneVisibility(() => undefined);

    expect(handler).toBe(remove);
  });

  it("calls back when the pane becomes visible, and not when it is hidden", async () => {
    const seen: string[] = [];
    // A box, because TypeScript narrows a `let` assigned only inside a callback
    // to `never` at the point of use \u2014 and a narrowing that turns a test into a
    // compile error hides the assertion rather than helping it.
    const emitter: { emit?: (message: { visibilityMode: string }) => void } = {};
    installOffice({
      onVisibilityModeChanged: vi.fn(async (handler: (m: { visibilityMode: string }) => void) => {
        emitter.emit = handler;
        return async () => undefined;
      }),
    });

    await watchTaskpaneVisibility(() => seen.push("read"));
    emitter.emit?.({ visibilityMode: "Taskpane" });
    emitter.emit?.({ visibilityMode: "Hidden" });

    // Only the arrival counts. "Hidden" is the user closing the pane, and reading
    // the document then would be work nobody asked for.
    expect(seen).toEqual(["read"]);
  });

  it("declines rather than throwing when the host refuses the subscription", async () => {
    installOffice({
      onVisibilityModeChanged: vi.fn(async () => {
        throw new Error("not supported");
      }),
    });

    await expect(watchTaskpaneVisibility(() => undefined)).resolves.toBeNull();
  });
});
