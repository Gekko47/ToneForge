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
        activePage="home"
        profileName="Corporate editorial"
        profileVersion="2.4.1"
        onNavigate={onNavigate}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Corporate editorial")).toBeInTheDocument();
    expect(screen.getByText("v2.4.1")).toBeInTheDocument();

    await user.click(trigger);
    const navigation = screen.getByRole("navigation", { name: "Task pane navigation" });
    expect(within(navigation).getByRole("button", { name: "Document Governance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(within(navigation).getByRole("button", { name: "Settings" }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
    await vi.waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
  });

  it("returns focus to the menu trigger when navigation closes", async () => {
    const user = userEvent.setup();
    render(
      <TaskPaneHeader
        activePage="home"
        profileName="Corporate editorial"
        profileVersion="1.0.0"
        onNavigate={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    await user.click(trigger);
    const closeButton = screen.getByRole("button", { name: "Close navigation" });
    fireEvent.click(closeButton);

    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });
});
