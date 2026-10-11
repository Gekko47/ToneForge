import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TaskPaneHeader from "../../../../src/taskpane/components/TaskPaneHeader";
import { PaneHeader } from "../../../../src/taskpane/shell";

describe("TaskPaneHeader", () => {
  it("opens a responsive navigation panel and marks the active destination", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <TaskPaneHeader
        activePage="review"
        onNavigate={onNavigate}
        paneHeader={<PaneHeader title="Deterministic Review" />}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Deterministic Review")).toBeInTheDocument();

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
    render(<TaskPaneHeader activePage="review" onNavigate={vi.fn()} paneHeader={null} />);
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "ToneForge navigation" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "ToneForge navigation" })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  it("traps keyboard focus in the open navigation dialog", async () => {
    const user = userEvent.setup();
    render(<TaskPaneHeader activePage="review" onNavigate={vi.fn()} paneHeader={null} />);
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
    render(<TaskPaneHeader activePage="review" onNavigate={vi.fn()} paneHeader={null} />);
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    await user.click(trigger);
    const closeButton = screen.getByRole("button", { name: "Close navigation" });
    fireEvent.click(closeButton);

    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  describe("the pane header slot", () => {
    it("renders the pane header content the caller supplies", () => {
      render(
        <TaskPaneHeader
          activePage="review"
          onNavigate={vi.fn()}
          paneHeader={
            <PaneHeader
              title="Deterministic Review"
              markers={[
                {
                  key: "profile",
                  label: "Style",
                  value: "Corporate editorial · r241",
                  tone: "neutral",
                },
                { key: "scan", label: "Last scan", value: "10/10/2026, 4:30:00 PM" },
              ]}
            />
          }
        />,
      );
      expect(screen.getByText("Deterministic Review")).toBeInTheDocument();
      expect(screen.getByText(/Corporate editorial/)).toBeInTheDocument();
      expect(screen.getByText(/Last scan/)).toBeInTheDocument();
    });

    it("renders no pane header when none is supplied", () => {
      render(<TaskPaneHeader activePage="review" onNavigate={vi.fn()} />);
      expect(screen.queryByText("Deterministic Review")).not.toBeInTheDocument();
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
          onNavigate={onNavigate}
          paneHeader={<PaneHeader title="Semantic Review" />}
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
          onNavigate={onNavigate}
          paneHeader={<PaneHeader title="Semantic Style" />}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Open navigation" }));
      const again = screen.getByRole("navigation", { name: "Task pane navigation" });
      expect(within(again).getByRole("button", { name: "Semantic Style" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    it("groups the three review modes together and the two styles together", async () => {
      const user = userEvent.setup();
      render(
        <TaskPaneHeader
          activePage="review"
          onNavigate={vi.fn()}
          paneHeader={<PaneHeader title="Deterministic Review" />}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Open navigation" }));
      const navigation = screen.getByRole("navigation", { name: "Task pane navigation" });

      // The unified IA (spec §6.1): the three review modes are primary and sit
      // under Review; the two style editors are secondary and sit under Styles.
      // The style editor used to sit with the policy pages, which is where
      // nobody found it.
      const reviewGroup = within(navigation).getByRole("group", { name: "Review" });
      expect(
        within(reviewGroup).getByRole("button", { name: "Deterministic Review" }),
      ).toBeInTheDocument();
      expect(
        within(reviewGroup).getByRole("button", { name: "Semantic Review" }),
      ).toBeInTheDocument();
      expect(
        within(reviewGroup).getByRole("button", { name: "Consistency Review" }),
      ).toBeInTheDocument();

      const stylesGroup = within(navigation).getByRole("group", { name: "Styles" });
      expect(
        within(stylesGroup).getByRole("button", { name: "Deterministic Style" }),
      ).toBeInTheDocument();
      expect(
        within(stylesGroup).getByRole("button", { name: "Semantic Style" }),
      ).toBeInTheDocument();
    });

    it("renames the two routes the unified UX renamed, and keeps the keys stable", async () => {
      const user = userEvent.setup();
      const onNavigate = vi.fn();
      render(
        <TaskPaneHeader
          activePage="review"
          onNavigate={onNavigate}
          paneHeader={<PaneHeader title="Deterministic Review" />}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Open navigation" }));
      const navigation = screen.getByRole("navigation", { name: "Task pane navigation" });

      // The label changed; the key did not, so the ribbon arrival mapping and
      // the persisted page keep working (ADR-0131).
      expect(
        within(navigation).queryByRole("button", { name: "Deterministic Style Profile" }),
      ).toBeNull();
      expect(within(navigation).queryByRole("button", { name: "Governance Policy" })).toBeNull();

      await user.click(within(navigation).getByRole("button", { name: "Deterministic Style" }));
      expect(onNavigate).toHaveBeenCalledWith("profile");
      await user.click(screen.getByRole("button", { name: "Open navigation" }));
      await user.click(
        within(screen.getByRole("navigation", { name: "Task pane navigation" })).getByRole(
          "button",
          {
            name: "Governance",
          },
        ),
      );
      expect(onNavigate).toHaveBeenCalledWith("governance-policy");
    });

    it("no longer offers the single 'Semantic' page the split replaced", async () => {
      const user = userEvent.setup();
      render(
        <TaskPaneHeader
          activePage="review"
          onNavigate={vi.fn()}
          paneHeader={<PaneHeader title="Deterministic Review" />}
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
