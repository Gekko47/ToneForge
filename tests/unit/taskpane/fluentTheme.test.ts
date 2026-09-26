import { describe, expect, it } from "vitest";
import { createDefaultTheme } from "../../../src/taskpane/fluentTheme";

describe("createDefaultTheme", () => {
  it("inverts the dark theme so Fluent paints its own controls dark", () => {
    // The load-bearing field. A dark palette on a non-inverted theme leaves
    // Dropdown, TextField, and Toggle rendering with light bodies.
    expect(createDefaultTheme(true).isInverted).toBe(true);
    expect(createDefaultTheme(false).isInverted).toBe(false);
  });

  it("writes the dark palette the way an inverted theme expects", () => {
    const dark = createDefaultTheme(true);
    // Foreground is light, surfaces are dark: the inverse of the light theme.
    expect(dark.palette.neutralPrimary).toBe("#f3f2f1");
    expect(dark.palette.neutralLighter).toBe("#292827");
    expect(dark.palette.neutralLight).toBe("#323130");
  });

  it("keeps the light theme uninverted with light surfaces", () => {
    const light = createDefaultTheme(false);
    expect(light.palette.neutralPrimary).toBe("#1f1f1f");
    expect(light.palette.neutralLighter).toBe("#f3f2f1");
  });
});
