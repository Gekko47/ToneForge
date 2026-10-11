import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PaneHeader } from "../../../../src/taskpane/shell/PaneHeader";
import type { PaneMarker } from "../../../../src/taskpane/shell/headerMarkers";
import { renderWithFluent, resetGriffelStyles } from "../../../helpers/fluentV9";

afterEach(() => {
  cleanup();
  resetGriffelStyles();
});

/**
 * The pane header's density, truncation, and accessibility contract (ADR-0138,
 * spec §5.5–§5.8).
 *
 * jsdom computes no styles, so the truncation rules are asserted through the
 * attributes that carry them rather than through layout: a truncated value is
 * recoverable because its full text is in `title`, and a label that hides at a
 * narrow width stays in the DOM because a `<dl>` without its `<dt>` is no
 * longer a definition list.
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

describe("PaneHeader", () => {
  it("gives exactly one h1, and it is the page title", () => {
    renderWithFluent(<PaneHeader title="Deterministic Review" />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("Deterministic Review");
  });

  it("carries the full title in title, so a truncated value is recoverable", () => {
    renderWithFluent(<PaneHeader title="Deterministic Review" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute(
      "title",
      "Deterministic Review",
    );
  });

  it("carries each marker's full value in title, on the value rather than the row", () => {
    renderWithFluent(<PaneHeader title="Deterministic Review" markers={MARKERS} />);
    // A toned marker renders its value inside a Fluent Badge, so the text node
    // is the badge's own span; the title belongs on the <dd> that wraps it.
    const value = screen.getByText("4 findings").closest("dd");
    expect(value).toHaveAttribute("title", "2 errors, 2 warnings");
    // The row itself carries no title: a tooltip on the wrapper would fire for
    // the label too, which is not the value being truncated.
    expect(value?.parentElement).not.toHaveAttribute("title");
  });

  it("keeps every marker label in the DOM, so the strip stays a definition list", () => {
    renderWithFluent(<PaneHeader title="Deterministic Review" markers={MARKERS} />);
    const list = document.querySelector("dl");
    expect(list).not.toBeNull();
    // One <dt> per labelled marker. A label that unmounts at a narrow width
    // would leave the values with nothing to attach them to.
    expect(list?.querySelectorAll("dt")).toHaveLength(3);
    expect(screen.getByText("Style")).toBeInTheDocument();
    expect(screen.getByText("Last scan")).toBeInTheDocument();
  });

  it("renders the warning as a note, never as a live region", () => {
    renderWithFluent(
      <PaneHeader
        title="LLM Settings"
        warning={{
          tone: "warning",
          title: "Provider required",
          body: "Semantic Review needs a configured LLM provider.",
          action: <button type="button">Connect</button>,
        }}
      />,
    );
    const note = screen.getByRole("note");
    expect(note).toBeInTheDocument();
    expect(note).not.toHaveAttribute("aria-live");
    // The pane's one live region stays in AppShell (ADR-0062), so a header
    // warning cannot announce over a scan result.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("renders no warning or marker strip when none is supplied", () => {
    renderWithFluent(<PaneHeader title="Home" />);
    expect(screen.queryByRole("note")).toBeNull();
    expect(document.querySelector("dl")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("keeps the status badge as text plus icon, never colour alone", () => {
    renderWithFluent(<PaneHeader title="Deterministic Review" status={{ label: "Stale" }} />);
    // The vocabulary word is present as text; the icon supplements it.
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("Stale").querySelector("svg")).not.toBeNull();
  });

  it("carries the status pill's tooltip, because the pill has no label beside it", () => {
    /*
     * The heading-row pill is the one pill in the header with nothing next to
     * it to say what it is about: the marker strip's labels hide below 370px,
     * and this pill is not in the strip. Without a tooltip a bare "Stale" or
     * "Ready" beside the title is a word with no referent.
     */
    renderWithFluent(
      <PaneHeader
        title="Deterministic Review"
        status={{ label: "Stale", title: "The document has changed since the last scan." }}
      />,
    );
    expect(screen.getByText("Stale").closest("div")).toHaveAttribute(
      "title",
      "The document has changed since the last scan.",
    );
  });

  it("leaves the status pill without a tooltip when the caller supplies none", () => {
    renderWithFluent(<PaneHeader title="Deterministic Review" status={{ label: "Stale" }} />);
    expect(screen.getByText("Stale").closest("div")).not.toHaveAttribute("title");
  });

  it("orders the header's focusable content title, then actions, then the warning action", () => {
    renderWithFluent(
      <PaneHeader
        title="Deterministic Review"
        actions={<button type="button">Re-scan</button>}
        warning={{
          tone: "warning",
          title: "Findings are stale",
          body: "The document has changed since the last scan.",
          action: <button type="button">Re-scan now</button>,
        }}
      />,
    );
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>("button, [href], [tabindex]"),
    );
    expect(focusable.map((el) => el.textContent)).toEqual(["Re-scan", "Re-scan now"]);
  });
});
