/**
 * Observable persisted state for the task pane.
 *
 * `core/state/persistence.ts` is the single writer of `ToneForge.State.v11` and
 * is deliberately unaware of React. This module is the thin subscription layer
 * that lets mounted components re-render when that state changes, without
 * `core/state` importing anything UI.
 *
 * The reason it exists: several components read `loadState()` during render and
 * therefore never see a change. Saving a consent toggle or a provider connection
 * in Settings re-rendered only the section that saved, so another surface kept
 * showing the pre-save value until the user navigated away and back. That is the
 * same trap `OpenRouterConnectionSettings` had to work around locally.
 *
 * **Reference stability is the whole design here.** `useSyncExternalStore`
 * re-renders forever if `getSnapshot` returns a fresh object each call, so the
 * snapshot is cached and only replaced when a write actually lands.
 *
 * **Subscription is not owned here.** This used to keep a private listener set
 * that only `persistState` notified, which left every convenience writer in
 * `persistence.ts` — ignore, restore, activate a profile, publish a draft —
 * writing to storage while the UI kept showing the old value. The ignore button
 * was the visible symptom: it saved correctly and appeared to do nothing. The
 * notification belongs to the write, so it now lives there.
 */

import { useSyncExternalStore } from "react";
import { loadState, saveState, subscribeToState, type PersistedState } from "../../core/state";

/**
 * `null` until the first read, rather than a value captured at import time.
 *
 * Reading at module scope would freeze whatever the store held when this file
 * was first imported, which is before any host or test has had a chance to set
 * up. Lazily taking the first snapshot on first use also keeps the cache valid
 * for `useSyncExternalStore`, which requires the same object identity until a
 * save actually lands.
 */
let cached: PersistedState | null = null;

/** Replace the cached snapshot with what is actually stored. */
function refresh(): void {
  cached = loadState();
}

function current(): PersistedState {
  if (cached === null) refresh();
  return cached as PersistedState;
}

function getSnapshot(): PersistedState {
  return current();
}

function getServerSnapshot(): PersistedState {
  return current();
}

/**
 * Subscribe to writes from any caller.
 *
 * The cache is refreshed once per write, before the listener runs, so every
 * subscriber in that pass observes the same object identity. Refreshing per
 * listener would hand two of them different objects and defeat the comparison
 * `useSyncExternalStore` relies on.
 */
function subscribe(listener: () => void): () => void {
  return subscribeToState(() => {
    refresh();
    listener();
  });
}

/**
 * Persist state and notify every subscriber.
 *
 * Kept for callers that already hold a whole `PersistedState`. `saveState`
 * notifies on its own now, so this is `saveState` with a name that reads as the
 * intent rather than a second notification.
 */
export function persistState(state: PersistedState): void {
  saveState(state);
}

/**
 * Read persisted state and re-render whenever it is persisted.
 *
 * Callers that only read the current value once, on mount, keep using
 * `loadState()`; the change that matters is that a component which reads state
 * *while the pane is open* no longer needs the user to navigate to see it.
 */
export function usePersistedState(): PersistedState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Reset the store between tests.
 *
 * `vitest.config.ts` sets `clearMocks` and `restoreMocks`, but module state is
 * not a mock, so a test that persisted state would otherwise leak that state into
 * the next test file's module instance. The listener set now lives in
 * `persistence.ts`, so this clears the snapshot and re-reads; the subscribers
 * themselves are removed by React on unmount.
 */
export function __resetPersistedStore(): void {
  cached = null;
}
