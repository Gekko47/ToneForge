import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TaskPaneHeader from "../../../../src/taskpane/components/TaskPaneHeader";

describe("TaskPaneHeader", () => {
  it("opens a responsive navigation panel and marks the active destination", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <TaskPaneHeader
        activePage="review"
        profileName="Corporate editorial"
        profileRevision={241}
        onNavigate={onNavigate}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Corporate editorial")).toBeInTheDocument();
    expect(screen.getByText("r241")).toBeInTheDocument();

    await user.click(trigger);
    const navigation = screen.getByRole("navigation", { name: "Task pane navigation" });
    expect(
      within(navigation).getByRole("button", { name: "Deterministic Review" }),
    ).toHaveAttribute("aria-current", "page");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(within(navigation).getByRole("button", { name: "LLM Settings" }));
    expect(onNavigate).toHaveBeenCalledWith("llm-settings");
    await vi.waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
  });

  it("closes on Escape and returns focus to the menu trigger", async () => {
    const user = userEvent.setup();
    render(
      <TaskPaneHeader
        activePage="review"
        profileName="Corporate editorial"
        profileRevision={7}
        onNavigate={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "ToneForge navigation" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "ToneForge navigation" })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  it("traps keyboard focus in the open navigation dialog", async () => {
    const user = userEvent.setup();
    render(
      <TaskPaneHeader
        activePage="review"
        profileName="Corporate editorial"
        profileRevision={7}
        onNavigate={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "ToneForge navigation" });
    const closeButton = screen.getByRole("button", { name: "Close navigation" });
    expect(closeButton).toHaveFocus();

    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("returns focus to the menu trigger when navigation closes", async () => {
    const user = userEvent.setup();
    render(
      <TaskPaneHeader
        activePage="review"
        profileName="Corporate editorial"
        profileRevision={7}
        onNavigate={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    await user.click(trigger);
    const closeButton = screen.getByRole("button", { name: "Close navigation" });
    fireEvent.click(closeButton);

    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  describe("the scan time", () => {
    it("says when the document was last scanned, without an observer there is none", () => {
      /*
       * On the stale banner the time could only appear when something was
       * already wrong, so the moment it was worth most — just after a
       * successful scan, with no banner rendered — it was nowhere on screen.
       */
      const { rerender } = render(
        <TaskPaneHeader
          activePage="review"
          profileName="Corporate editorial"
          profileRevision={7}
          onNavigate={vi.fn()}
          lastScan="2026-09-26T09:30:00.000Z"
        />,
      );
      expect(screen.getByText(/^Last scan:/)).toBeInTheDocument();

      // `undefined` means no observer is running on this page. Printing a time
      // there would be a claim about a scan that never happened.
      rerender(
        <TaskPaneHeader
          activePage="llm-settings"
          profileName="Corporate editorial"
          profileRevision={7}
          onNavigate={vi.fn()}
        />,
      );
      expect(screen.queryByText(/^Last scan:/)).not.toBeInTheDocument();
    });

    it("says never rather than a date when nothing has been scanned", () => {
      render(
        <TaskPaneHeader
          activePage="review"
          profileName="Corporate editorial"
          profileRevision={7}
          onNavigate={vi.fn()}
          lastScan={null}
        />,
      );
      expect(screen.getByText("Last scan: never")).toBeInTheDocument();
    });

    it("is plain text, not a second live region", () => {
      /*
       * The pane speaks from one live region. A second one here would read the
       * scan time over whatever the pane was actually announcing.
       */
      render(
        <TaskPaneHeader
          activePage="review"
          profileName="Corporate editorial"
          profileRevision={7}
          onNavigate={vi.fn()}
          lastScan="2026-09-26T09:30:00.000Z"
        />,
      );
      expect(screen.getByText(/^Last scan:/)).not.toHaveAttribute("aria-live");
      expect(screen.getByText(/^Last scan:/)).not.toHaveAttribute("role", "status");
    });
  });

  /*
   * The two semantic destinations, and what they mean for the ribbon.
   *
   * D10: one command, `ToneForgeSemantic`, opening Semantic Review. Style is a
   * second *pane* destination reached from here and from the Review page, not a
   * second ribbon button — `duplicateNavigationTargets()` in
   * `commands.test.ts` is what enforces the one-command half of that, and this
   * is what enforces the two-destination half.
   */
  describe("the semantic destinations", () => {
    it("offers both, and each navigates to its own page", async () => {
      const user = userEvent.setup();
      const onNavigate = vi.fn();
      const { rerender } = render(
        <TaskPaneHeader
          activePage="semantic-review"
          profileName="Corporate editorial"
          profileRevision={7}
          onNavigate={onNavigate}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Open navigation" }));
      const navigation = screen.getByRole("navigation", { name: "Task pane navigation" });
      // The drawer is a `<nav>`, so the breadcrumb on the page is not a second
      // match for this query.
      expect(within(navigation).getByRole("button", { name: "Semantic Review" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await user.click(within(navigation).getByRole("button", { name: "Semantic Style" }));
      expect(onNavigate).toHaveBeenCalledWith("semantic-style");

      // And the style page is a destination in its own right, not a mode of the
      // review page — otherwise `aria-current` would never be able to mark it.
      rerender(
        <TaskPaneHeader
          activePage="semantic-style"
          profileName="Corporate editorial"
          profileRevision={7}
          onNavigate={onNavigate}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Open navigation" }));
      const again = screen.getByRole("navigation", { name: "Task pane navigation" });
      expect(within(again).getByRole("button", { name: "Semantic Style" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    it("puts them next to each other rather than among the policy pages", async () => {
      const user = userEvent.setup();
      render(
        <TaskPaneHeader
          activePage="review"
          profileName="Corporate editorial"
          profileRevision={7}
          onNavigate={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Open navigation" }));
      const labels = within(screen.getByRole("navigation", { name: "Task pane navigation" }))
        .getAllByRole("button")
        .map((button) => button.textContent);

      // The style editor used to sit with the policy pages, which is where
      // nobody found it. It belongs beside the review it feeds.
      const review = labels.indexOf("Semantic Review");
      const style = labels.indexOf("Semantic Style");
      expect(review).toBeGreaterThanOrEqual(0);
      expect(style).toBe(review + 1);
    });

    it("no longer offers the single 'Semantic' page the split replaced", async () => {
      const user = userEvent.setup();
      render(
        <TaskPaneHeader
          activePage="review"
          profileName="Corporate editorial"
          profileRevision={7}
          onNavigate={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Open navigation" }));
      const navigation = screen.getByRole("navigation", { name: "Task pane navigation" });
      // A name that now means nothing is worse than no name: it is a destination
      // the pane cannot open.
      expect(within(navigation).queryByRole("button", { name: "Semantic" })).toBeNull();
    });
  });
});
