/**
 * Observable persisted state for the task pane.
 *
 * `core/state/persistence.ts` is the single writer of `ToneForge.State.v9` and is
 * deliberately unaware of React. This module is the thin subscription layer that
 * lets mounted components re-render when that state changes, without `core/state`
 * importing anything UI.
 *
 * The reason it exists: several components read `loadState()` during render and
 * therefore never see a change. Saving a consent toggle or a provider connection
 * in Settings re-rendered only the section that saved, so another surface kept
 * showing the pre-save value until the user navigated away and back. That is the
 * same trap `OpenRouterConnectionSettings` had to work around locally.
 *
 * **Reference stability is the whole design here.** `useSyncExternalStore`
 * re-renders forever if `getSnapshot` returns a fresh object each call, so the
 * snapshot is cached and only replaced when a save actually lands.
 */

import { useSyncExternalStore } from "react";
import { loadState, saveState, type PersistedState } from "../../core/state";

type Listener = () => void;

const listeners = new Set<Listener>();

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

function emit(): void {
  // Snapshot taken once per emission so every subscriber in this pass observes
  // the same object identity; re-reading per listener would defeat the cache.
  cached = loadState();
  listeners.forEach((listener) => {
    listener();
  });
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function current(): PersistedState {
  if (cached === null) cached = loadState();
  return cached;
}

function getSnapshot(): PersistedState {
  return current();
}

function getServerSnapshot(): PersistedState {
  return current();
}

/**
 * Persist state and notify every subscriber.
 *
 * This is the only writer the task pane uses. Going through it rather than
 * calling `saveState` directly is what makes the store correct: a direct call
 * would persist the value and leave the UI showing the old one.
 */
export function persistState(state: PersistedState): void {
  saveState(state);
  emit();
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
 * not a mock, so a test that persists state would otherwise leak that state into
 * the next test file's module instance.
 */
export function __resetPersistedStore(): void {
  listeners.clear();
  cached = null;
}
