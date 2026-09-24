import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "../../../src/taskpane/theme";

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
});
