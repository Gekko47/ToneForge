import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  __resetPersistedStore,
  persistState,
  usePersistedState,
} from "../../../../src/taskpane/state/usePersistedState";
import { loadState, type PersistedState } from "../../../../src/core/state/persistence";

function withProvider(provider: PersistedState["settings"]["llmProvider"]): PersistedState {
  return {
    ...(loadState() as PersistedState),
    settings: { ...loadState().settings, llmProvider: provider },
  };
}

function Consumer({ label }: { label: string }): React.ReactNode {
  const persisted = usePersistedState();
  return <p data-testid={label}>{String(persisted.settings.llmProvider)}</p>;
}

/**
 * The store exists because components used to call `loadState()` during render
 * and therefore never saw a change: a consent toggle saved in one section left
 * every other surface showing the pre-save value until the user navigated away
 * and back. These tests mount two consumers and assert one save reaches both.
 */
describe("usePersistedState", () => {
  beforeEach(() => {
    __resetPersistedStore();
    window.localStorage.clear();
  });

  afterEach(() => {
    __resetPersistedStore();
  });

  it("returns a stable reference across renders with no save", () => {
    const seen: unknown[] = [];
    function Probe(): React.ReactNode {
      const persisted = usePersistedState();
      seen.push(persisted);
      return <p>{seen.length}</p>;
    }
    const { rerender } = render(<Probe />);
    rerender(<Probe />);
    // `useSyncExternalStore` loops forever if the snapshot is a fresh object
    // each call, so identity must hold until a save actually lands.
    expect(seen[0]).toBe(seen[1]);
  });

  it("updates every mounted consumer when state is persisted", () => {
    render(
      <>
        <Consumer label="first" />
        <Consumer label="second" />
      </>,
    );
    expect(screen.getByTestId("first")).toHaveTextContent("mock");
    expect(screen.getByTestId("second")).toHaveTextContent("mock");

    act(() => {
      persistState(withProvider("openrouter"));
    });

    expect(screen.getByTestId("first")).toHaveTextContent("openrouter");
    expect(screen.getByTestId("second")).toHaveTextContent("openrouter");
  });

  it("persists through the core writer rather than beside it", () => {
    persistState({ ...(loadState() as PersistedState) });
    // The store must not invent a second storage path: a value written here has
    // to be readable by everything that uses `loadState()`.
    expect(loadState().settings.llmProvider).toBe("mock");
  });

  it("stops notifying after unmount", () => {
    const { unmount } = render(<Consumer label="first" />);
    unmount();
    // A save after unmount must not throw or reach a dead listener.
    expect(() =>
      act(() => {
        persistState(withProvider("anthropic"));
      }),
    ).not.toThrow();
  });
});
