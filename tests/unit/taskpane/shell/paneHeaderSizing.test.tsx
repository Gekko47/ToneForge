import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PaneHeader } from "../../../../src/taskpane/shell/PaneHeader";
import type { PaneMarker } from "../../../../src/taskpane/shell/headerMarkers";
import { renderWithFluent } from "../../../helpers/fluentV9";

/**
 * The header's sizing rules, asserted from the CSSOM rather than from the
 * source text.
 *
 * jsdom computes no layout, so a rule cannot be checked by measuring anything.
 * Reading the stylesheet Griffel actually emits is the next best thing and is
 * strictly stronger than matching the source: a rule that never reaches the
 * stylesheet is a rule that does not exist, and a source-level string match
 * would happily pass on one that was silently dropped.
 *
 * This file deliberately does **not** call `resetGriffelStyles()`. Griffel emits
 * each rule once and caches it, so removing the style element leaves the rule
 * gone for the rest of the file — every assertion after the first would read an
 * empty stylesheet and pass vacuously. The head grows by one element per test
 * here, which is the cost of reading real rules.
 */

const MARKERS: readonly PaneMarker[] = [
  { key: "style", label: "Style", value: "Finance · r3" },
  { key: "scan", label: "Last scan", value: "16:04" },
  {
    key: "open",
    label: "Open",
    value: "4 findings",
    tone: "warning",
    title: "2 errors, 2 warnings",
  },
];

afterEach(cleanup);

/** Every rule Griffel has emitted into the document. */
function emittedRules(): string {
  return Array.from(document.styleSheets)
    .flatMap((sheet): CSSRule[] => {
      try {
        return Array.from(sheet.cssRules);
      } catch {
        return [];
      }
    })
    .map((rule) => rule.cssText)
    .join("\n");
}

/** Every atomic rule Griffel emitted for one element's own classes. */
function rulesFor(element: Element): string {
  return Array.from(element.classList)
    .map((className) => {
      const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\.${escaped}\\s*\\{[^}]*\\}`).exec(emittedRules())?.[0] ?? "";
    })
    .join(" ");
}

describe("the header's sizing rules", () => {
  it("never caps a marker label at a percentage of the strip", () => {
    renderWithFluent(<PaneHeader title="Deterministic Review" markers={MARKERS} />);
    /*
     * The cap used to be `max-width: 50%`, which resolved against the strip's
     * shrink-to-fit width and so truncated a label by how much room its *own*
     * value needed — the narrower the value, the shorter the label. A
     * percentage cap on the label is the defect, not the fix.
     */
    expect(rulesFor(screen.getByText("Style"))).not.toMatch(/max-width:\s*\d+%/);
  });

  it("pins the label to its content and lets only the value shrink", () => {
    renderWithFluent(<PaneHeader title="Deterministic Review" markers={MARKERS} />);
    expect(rulesFor(screen.getByText("Style"))).toContain("flex-shrink: 0");
    expect(rulesFor(screen.getByText("Finance · r3"))).toContain("min-width: 0");
  });

  it("gives the strip no height cap, so a third row grows the header instead of clipping a pill", () => {
    renderWithFluent(<PaneHeader title="Deterministic Review" markers={MARKERS} />);
    const strip = document.querySelector("dl");
    expect(strip).not.toBeNull();
    expect(rulesFor(strip as Element)).not.toMatch(/max-height/);
  });

  it("hides the labels by the strip's own width, not the viewport's", () => {
    renderWithFluent(<PaneHeader title="Deterministic Review" markers={MARKERS} />);
    const strip = document.querySelector("dl");
    expect(rulesFor(strip as Element)).toContain("container-type: inline-size");
    // A docked pane's strip is narrower than the window, so a viewport query
    // fires late and lets the strip wrap to three rows first.
    expect(emittedRules()).toContain("@container (max-width: 370px)");
  });

  it("houses the status pill's icon at the large size", () => {
    renderWithFluent(<PaneHeader title="Deterministic Review" status={{ label: "Stale" }} />);
    // 24px is the smallest Badge size whose 16px icon is not cramped; the
    // default medium is 20px with a 12px icon.
    const pill = Array.from(document.querySelectorAll<HTMLElement>("header *")).find((el) =>
      /min-width:\s*24px/.test(rulesFor(el)),
    );
    expect(pill).toBeDefined();
    expect(rulesFor(pill as Element)).toMatch(/height:\s*24px/);
  });

  it("sets the heading row to the pill's height, so the title and pill share a centre", () => {
    renderWithFluent(<PaneHeader title="Deterministic Review" status={{ label: "Stale" }} />);
    const heading = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(heading).toBeDefined();
    expect(rulesFor(heading as Element)).toMatch(/height:\s*24px/);
  });

  it("zeroes the page ramp's bottom margin on the title, so it cannot offset the pill", () => {
    renderWithFluent(<PaneHeader title="Deterministic Review" status={{ label: "Stale" }} />);
    // The ramp gives every h1 `margin: 0 0 var(--tf-space-3)`. Inside a flex
    // row that is not breathing room — it lifts the title off the pill's
    // centre line by 12px.
    expect(rulesFor(screen.getByRole("heading", { level: 1 }))).toMatch(
      /margin:\s*0(?![^;]*[1-9])/,
    );
  });
});
