import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, Dropdown, Option } from "@fluentui/react-components";
import {
  toneForgeBrandRamp,
  toneForgeDarkTheme,
  toneForgeIcons,
  toneForgeLightTheme,
  toneForgeTokens,
} from "../../../src/taskpane/theme/index";
import { renderWithFluent, resetGriffelStyles } from "../../helpers/fluentV9";

/**
 * The v9 foundation, asserted rather than assumed.
 *
 * jsdom computes no styles, so nothing here claims a rendered pixel. What it can
 * check is that the pieces the migration depends on actually resolve: the brand
 * is anchored where the plan says, the two themes are distinct, and no icon or
 * token in the maps is a hole that would render as a blank square or an
 * unresolved `var()`.
 */
describe("Fluent v9 foundation", () => {
  it("anchors the brand on the accent the pane already used", () => {
    expect(toneForgeBrandRamp[80].toLowerCase()).toBe("#0078d4");
    expect(toneForgeLightTheme.colorBrandBackground.toLowerCase()).toBe("#0078d4");
  });

  it("builds two distinct themes from one ramp", () => {
    expect(toneForgeLightTheme).not.toBe(toneForgeDarkTheme);
    expect(toneForgeLightTheme.colorNeutralBackground1).not.toBe(
      toneForgeDarkTheme.colorNeutralBackground1,
    );
  });

  it("resolves every icon in the map", () => {
    const missing = Object.entries(toneForgeIcons)
      .filter(([, icon]) => icon === undefined)
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("resolves every token in the map", () => {
    const missing = Object.entries(toneForgeTokens)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("renders a v9 component under the provider", () => {
    renderWithFluent(<Button>Review</Button>);
    expect(screen.getByRole("button", { name: "Review" })).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("still opens a dropdown popup under the global positioning configuration", async () => {
    // The provider disables resize-driven repositioning for every Fluent popup
    // to break the ResizeObserver loop. That must not stop a popup from opening
    // and rendering its options.
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderWithFluent(
      <Dropdown placeholder="Pick one">
        <Option value="a">Alpha</Option>
        <Option value="b">Beta</Option>
      </Dropdown>,
    );

    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    resetGriffelStyles();
  });
});
