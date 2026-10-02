/**
 * Live caret tracking (plan P16, ADR-0094).
 *
 * Three properties matter here, and only one of them is about the Office API.
 *
 * The API question — does `addHandlerAsync` exist, and does Word honour it — is
 * answered by a host, not by a suite, which is why `watchDocumentSelection`
 * returns a boolean rather than throwing. These tests therefore assert what the
 * module does with each answer, because "the host said no" and "the host said
 * nothing" must both degrade to the press-to-read behaviour this product already
 * shipped with, and neither may take the pane down.
 *
 * The debounce is asserted because it is the difference between following the
 * caret and reading the document on every keystroke. Without it this module would
 * be a performance defect that looks like a feature.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isWatchingDocumentSelection,
  stopWatchingDocumentSelection,
  watchDocumentSelection,
} from "../../../src/word/selectionWatcher";
import { logger } from "../../../src/shared/utils/logger";

interface FakeContext {
  addHandlerAsync?: (eventType: string, callback: () => void) => Promise<unknown>;
  removeHandlerAsync?: (eventType: string, options?: { id?: string }) => Promise<unknown>;
}

/**
 * Both halves installed by default.
 *
 * `addHandlerAsync` without `removeHandlerAsync` is a host this suite can model
 * but a real one almost certainly cannot, and it is the case the module warns
 * about. It gets its own test rather than being the default, because the default
 * has to be a host that behaves normally or every other assertion is testing an
 * edge case by accident.
 */
function installOffice(context: FakeContext | null): FakeContext {
  const installed = context ?? {
    addHandlerAsync: vi.fn(async () => ({ value: { id: "reg-1" } })),
    removeHandlerAsync: vi.fn(async () => undefined),
  };
  (globalThis as { Office?: unknown }).Office = { context: installed };
  return installed;
}

function removeOffice(): void {
  delete (globalThis as { Office?: unknown }).Office;
}

/** The callback the module handed to `addHandlerAsync`, for firing the event. */
function handlerOf(context: FakeContext): (() => void) | undefined {
  const mock = context.addHandlerAsync as unknown as { mock?: { calls: unknown[][] } };
  const call = mock?.mock?.calls[0];
  return call?.[1] as (() => void) | undefined;
}

describe("the document-selection watcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await stopWatchingDocumentSelection();
    vi.useRealTimers();
    removeOffice();
  });

  it("subscribes to the event Office documents", async () => {
    const context = installOffice(null);

    await expect(watchDocumentSelection(() => undefined)).resolves.toBe(true);

    expect(context.addHandlerAsync).toHaveBeenCalledWith(
      "documentSelectionChanged",
      expect.any(Function),
    );
    expect(isWatchingDocumentSelection()).toBe(true);
  });

  it("declines, rather than throwing, when there is no Office runtime at all", async () => {
    removeOffice();

    await expect(watchDocumentSelection(() => undefined)).resolves.toBe(false);
    expect(isWatchingDocumentSelection()).toBe(false);
  });

  it("declines when the host exposes no way to subscribe", async () => {
    installOffice({});

    await expect(watchDocumentSelection(() => undefined)).resolves.toBe(false);
  });

  /*
   * A designed fallback is not a fault, and the log level is the claim.
   *
   * This logged at `warn` on the rule that every refusal should name itself. The
   * rule is right for a loss and wrong here: nothing is lost, the caller is
   * handed `false` and reads on demand, and the page tells the user so in as many
   * words. A warning is read as "something is wrong", so it dressed a documented
   * consequence of ADR-0103 as an error every time Semantic Review mounted \u2014 and
   * buried the refusals that are refusals.
   *
   * Asserted rather than noted, because a log level nobody tests drifts back to
   * the louder setting the first time someone adds a `refusalCategory` to it out
   * of habit.
   */
  it("does not warn about a host that simply has no selection event", async () => {
    const warn = vi.spyOn(logger, "warn");
    installOffice({});

    await expect(watchDocumentSelection(() => undefined)).resolves.toBe(false);

    expect(warn).not.toHaveBeenCalled();
  });

  it("declines when the host refuses the subscription", async () => {
    installOffice({
      addHandlerAsync: vi.fn(async () => Promise.reject(new Error("no"))),
      removeHandlerAsync: vi.fn(async () => undefined),
    });

    await expect(watchDocumentSelection(() => undefined)).resolves.toBe(false);
    expect(isWatchingDocumentSelection()).toBe(false);
  });

  it("reads once for a burst of caret moves, not once per move", async () => {
    const onChanged = vi.fn();
    const context = installOffice(null);
    await watchDocumentSelection(onChanged, { debounceMs: 100 });
    const handler = handlerOf(context);
    expect(handler).toBeDefined();

    handler?.();
    handler?.();
    handler?.();
    expect(onChanged).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("re-points an existing subscription rather than adding a second one", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const context = installOffice(null);
    await watchDocumentSelection(first, { debounceMs: 10 });

    await expect(watchDocumentSelection(second, { debounceMs: 10 })).resolves.toBe(true);

    expect(context.addHandlerAsync).toHaveBeenCalledTimes(1);
    handlerOf(context)?.();
    vi.advanceTimersByTime(10);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes using the registration the host handed back", async () => {
    const context = installOffice(null);
    await watchDocumentSelection(() => undefined, { debounceMs: 10 });

    await stopWatchingDocumentSelection();

    expect(context.removeHandlerAsync).toHaveBeenCalledWith("documentSelectionChanged", {
      id: "reg-1",
    });
    expect(isWatchingDocumentSelection()).toBe(false);
  });

  it("unsubscribes without an id when the host returned no registration", async () => {
    const context = installOffice({
      addHandlerAsync: vi.fn(async () => undefined),
      removeHandlerAsync: vi.fn(async () => undefined),
    });
    await watchDocumentSelection(() => undefined, { debounceMs: 10 });

    await stopWatchingDocumentSelection();

    expect(context.removeHandlerAsync).toHaveBeenCalledWith("documentSelectionChanged", undefined);
  });

  it("drops a debounce still in flight, because the page it called is gone", async () => {
    const onChanged = vi.fn();
    const context = installOffice(null);
    await watchDocumentSelection(onChanged, { debounceMs: 100 });
    handlerOf(context)?.();

    await stopWatchingDocumentSelection();
    vi.advanceTimersByTime(200);

    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does not reject when the host refuses the unsubscribe", async () => {
    installOffice({
      addHandlerAsync: vi.fn(async () => ({ value: { id: "reg-1" } })),
      removeHandlerAsync: vi.fn(async () => Promise.reject(new Error("already gone"))),
    });
    await watchDocumentSelection(() => undefined, { debounceMs: 10 });

    await expect(stopWatchingDocumentSelection()).resolves.toBeUndefined();
    expect(isWatchingDocumentSelection()).toBe(false);
  });

  it("says so when a host can subscribe but cannot unsubscribe", async () => {
    /*
     * The handler then outlives the page that registered it. There is nothing the
     * user can do about it, so the only honest option is to state it: a leak
     * nobody can see is the thing every other refusal in this codebase exists to
     * prevent.
     */
    const context = installOffice({
      addHandlerAsync: vi.fn(async () => ({ value: { id: "reg-1" } })),
    });
    await watchDocumentSelection(() => undefined, { debounceMs: 10 });

    await stopWatchingDocumentSelection();

    expect(isWatchingDocumentSelection()).toBe(false);
    expect(context.removeHandlerAsync).toBeUndefined();
  });

  it("is safe to stop when nothing was ever watched", async () => {
    await expect(stopWatchingDocumentSelection()).resolves.toBeUndefined();
  });
});
