import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { FluentV9Provider, useTheme } = await import("../../../src/taskpane/theme");

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

describe("FluentV9Provider", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("tf-theme-dark", "tf-theme-light");
    vi.restoreAllMocks();
  });

  it("applies and persists a committed dark preference across provider mounts", () => {
    const first = render(
      <FluentV9Provider>
        <ThemeHarness />
      </FluentV9Provider>,
    );
    expect(document.documentElement.classList.contains("tf-theme-light")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save dark" }));
    expect(document.documentElement.classList.contains("tf-theme-dark")).toBe(true);
    expect(window.localStorage.getItem("ToneForge.ThemePreference")).toBe("dark");
    first.unmount();

    const second = render(
      <FluentV9Provider>
        <ThemeHarness />
      </FluentV9Provider>,
    );
    expect(second.getByLabelText("preference")).toHaveTextContent("dark");
    expect(document.documentElement.classList.contains("tf-theme-dark")).toBe(true);
  });

  it("exposes the theme preference and a setter through context", () => {
    render(
      <FluentV9Provider>
        <ThemeHarness />
      </FluentV9Provider>,
    );
    expect(screen.getByLabelText("preference")).toHaveTextContent("system");
  });

  it("re-rendering with no theme change keeps the same CSS class", () => {
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
      <FluentV9Provider>
        <RerenderingHost />
      </FluentV9Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rerender" }));
    fireEvent.click(screen.getByRole("button", { name: "Rerender" }));

    expect(screen.getByLabelText("tick")).toHaveTextContent("2");
    // The theme class is stable across re-renders.
    expect(document.documentElement.classList.contains("tf-theme-light")).toBe(true);
  });
});
