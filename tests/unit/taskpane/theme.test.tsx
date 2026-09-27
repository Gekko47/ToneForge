import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as FluentThemeModule from "../../../src/taskpane/fluentTheme";

/*
 * `createDefaultTheme` is mocked so the tests can count how many themes the
 * provider builds. That count is the thing under test: Fluent's own
 * `useTheme` hands back a stable reference even when the provider is handed a
 * new theme object, so identity cannot be observed from the outside — but the
 * work of building (and the identity churn behind it) can.
 */
const createThemeCalls: boolean[] = [];
vi.mock("../../../src/taskpane/fluentTheme", async (importOriginal) => {
  const actual = await importOriginal<typeof FluentThemeModule>();
  return {
    ...actual,
    createDefaultTheme: (dark = false) => {
      createThemeCalls.push(dark);
      return actual.createDefaultTheme(dark);
    },
  };
});

const { ThemeProvider, useTheme } = await import("../../../src/taskpane/theme");

function ThemeHarness(): ReactNode {
  const { themePreference, setThemePreference } = useTheme();
  return (
    <div>
      <output aria-label="preference">{themePreference}</output>
      <button type="button" onClick={() => setThemePreference("dark")}>
        Save dark
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    createThemeCalls.length = 0;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("applies and persists a committed dark preference across provider mounts", () => {
    const first = render(
      <ThemeProvider>
        <ThemeHarness />
      </ThemeProvider>,
    );
    expect(first.container.querySelector(".tf-theme-light")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save dark" }));
    expect(first.container.querySelector(".tf-theme-dark")).toBeInTheDocument();
    expect(window.localStorage.getItem("ToneForge.ThemePreference")).toBe("dark");
    first.unmount();

    const second = render(
      <ThemeProvider>
        <ThemeHarness />
      </ThemeProvider>,
    );
    expect(second.getByLabelText("preference")).toHaveTextContent("dark");
    expect(second.container.querySelector(".tf-theme-dark")).toBeInTheDocument();
  });

  /**
   * A re-render must not build a new theme.
   *
   * `createDefaultTheme` builds a fresh object on every call, so passing its
   * result straight to `FluentThemeProvider` meant a new theme identity on every
   * render, invalidating the theme for every Fluent consumer in the pane. That
   * is wasted work on an idle pane and a lock-up when something else is already
   * re-rendering — a failing document scan emits a new status on every attempt,
   * so each of those emissions restyled the whole pane.
   */
  it("does not rebuild the theme when a re-render changes nothing about it", () => {
    function RerenderingHost(): ReactNode {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTick(tick + 1)}>
            Rerender
          </button>
          <output aria-label="tick">{tick}</output>
        </>
      );
    }

    render(
      <ThemeProvider>
        <RerenderingHost />
      </ThemeProvider>,
    );
    const afterMount = createThemeCalls.length;

    fireEvent.click(screen.getByRole("button", { name: "Rerender" }));
    fireEvent.click(screen.getByRole("button", { name: "Rerender" }));

    expect(screen.getByLabelText("tick")).toHaveTextContent("2");
    // Two re-renders that changed no theme input must build no theme at all.
    expect(createThemeCalls.length).toBe(afterMount);
  });

  it("still applies a real theme change", () => {
    render(
      <ThemeProvider>
        <ThemeHarness />
      </ThemeProvider>,
    );

    // Both themes are built once on mount, so the dark one is already waiting
    // and the change costs no further construction.
    expect(createThemeCalls).toEqual([false, true]);
    const before = createThemeCalls.length;

    fireEvent.click(screen.getByRole("button", { name: "Save dark" }));
    expect(document.documentElement.classList.contains("tf-theme-dark")).toBe(true);

    // Further re-renders after the change still build nothing.
    fireEvent.click(screen.getByRole("button", { name: "Save dark" }));
    expect(createThemeCalls.length).toBe(before);
  });
});
