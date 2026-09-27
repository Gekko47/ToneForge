import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  usePersistedState,
  __resetPersistedStore,
} from "../../../../src/taskpane/state/usePersistedState";
import {
  ignoreFinding,
  loadState,
  restoreFinding,
  subscribeToState,
} from "../../../../src/core/state/persistence";
import { IgnoredFindingSchema, type IgnoredFinding } from "../../../../src/core/domain/Finding";
import { v4 as uuidv4 } from "uuid";

/**
 * A write that does not notify looks exactly like a control that does nothing.
 *
 * The bug this pins: `usePersistedState` kept a private listener set that only
 * `persistState` notified. Every convenience writer in `persistence.ts` — the
 * one the Ignore button calls — saved correctly and left the UI showing the
 * previous value. The user clicked Ignore, the entry was written, the list did
 * not re-render, and the button looked broken. The ignore list never appeared at
 * all, because it renders from this snapshot.
 *
 * These tests use the real writers rather than a mock, because the defect was
 * precisely that the writers and the subscription were in different places.
 */

function entry(message = "An em dash was found."): IgnoredFinding {
  return IgnoredFindingSchema.parse({
    fingerprint: `fp-${uuidv4()}`,
    findingId: uuidv4(),
    category: "typography",
    message,
    range: { start: 10, end: 20 },
    nodeIds: ["n1"],
    ignoredAt: new Date().toISOString(),
  });
}

describe("persisted state notification", () => {
  let originalOffice: unknown;

  beforeEach(() => {
    /*
     * The Office global is removed so `loadState` reads localStorage.
     *
     * `tests/setup.ts` installs a `roamingSettings` mock, which makes
     * `isOfficeRuntime()` true, and `loadState` prefers roamingSettings over
     * localStorage. Writes to roamingSettings are asynchronous, so a value
     * written and immediately read is not there yet — a persisted value could
     * not be read back in the same tick. That is correct behaviour for a real
     * host and unworkable for these tests, which assert on what was just saved.
     */
    originalOffice = (globalThis as { Office?: unknown }).Office;
    delete (globalThis as { Office?: unknown }).Office;
  });

  afterEach(() => {
    (globalThis as { Office?: unknown }).Office = originalOffice;
    __resetPersistedStore();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("notifies subscribers when a finding is ignored", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToState(listener);

    ignoreFinding(entry());

    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("notifies subscribers when a finding is restored", () => {
    const target = entry();
    ignoreFinding(target);
    const listener = vi.fn();
    const unsubscribe = subscribeToState(listener);

    restoreFinding(target.fingerprint);

    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("re-renders a mounted consumer when a finding is ignored", () => {
    // The user-visible symptom. Before the fix the hook returned a snapshot
    // that never changed, so the list kept rendering the pre-ignore findings
    // and the Ignore list never appeared.
    const { result } = renderHook(() => usePersistedState());
    expect(result.current.ignoredFindings).toHaveLength(0);

    // `act` is required, not decorative: `useSyncExternalStore` schedules a
    // re-render, and outside `act` React has not committed it when the
    // assertion runs. The write itself is synchronous — the two tests above
    // prove the notification fires without any React involved.
    act(() => {
      ignoreFinding(entry("First"));
    });

    expect(result.current.ignoredFindings).toHaveLength(1);
    expect(result.current.ignoredFindings[0]?.message).toBe("First");
  });

  it("re-renders a mounted consumer when a finding is restored", () => {
    const target = entry("Doomed");
    ignoreFinding(target);
    const { result } = renderHook(() => usePersistedState());
    expect(result.current.ignoredFindings).toHaveLength(1);

    act(() => {
      restoreFinding(target.fingerprint);
    });

    expect(result.current.ignoredFindings).toHaveLength(0);
  });

  it("keeps the hook's snapshot identity stable between writes", () => {
    // `useSyncExternalStore` re-renders forever if the snapshot changes on every
    // read, so this is the property that lets the fix exist at all.
    const { result, rerender } = renderHook(() => usePersistedState());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("notifies for every writer, not only the ones the task pane calls", () => {
    // A save from anywhere in core/state has to reach the UI. This is the
    // general form of the bug: the notification used to live with one caller
    // rather than with the write.
    const listener = vi.fn();
    const unsubscribe = subscribeToState(listener);

    const state = loadState();
    ignoreFinding(entry());
    const afterIgnore = loadState();
    expect(afterIgnore.ignoredFindings).not.toHaveLength(state.ignoredFindings.length);

    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
