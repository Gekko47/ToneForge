import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/core/state/persistence", () => ({
  loadState: vi.fn(() => ({
    version: 7,
    profileRecords: {},
    activeProfileId: null,
    governanceProfiles: {},
    governanceHistory: {},
    activeGovernanceProfileId: null,
    settings: {
      llmProvider: "mock",
      openAiCredentialMode: "broker",
      semanticOptIn: false,
    },
  })),
}));

vi.mock("../../../../src/taskpane/pages/Profile", () => ({
  default: function ProfileSetup(): React.ReactNode {
    return <div>Profile setup editor</div>;
  },
}));

import Dashboard from "../../../../src/taskpane/pages/Dashboard";

describe("Dashboard first-run state", () => {
  it("offers profile setup instead of throwing when no style profile exists", async () => {
    render(<Dashboard />);

    expect(screen.getByRole("heading", { name: "Create a style profile" })).toBeInTheDocument();
    expect(
      screen.getByText(/needs a style profile before it can analyse or safely reformat/i),
    ).toBeInTheDocument();
    expect(await screen.findByText("Profile setup editor")).toBeInTheDocument();
  });

  /**
   * The first-run state used to render a bare `<main>` with no header, so a
   * user with no profile could not reach Settings. That is a real lockout: the
   * AI Review consent lives there, and reading what you agree to before creating
   * a profile was impossible.
   */
  it("keeps navigation available before a profile exists", async () => {
    render(<Dashboard />);
    await screen.findByText("Profile setup editor");

    expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
    expect(screen.getByText(/Scanning and applying changes stay unavailable/)).toBeInTheDocument();
  });

  it("reaches Settings from the first-run state", async () => {
    render(<Dashboard />);
    await screen.findByText("Profile setup editor");

    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("does not offer a profile-dependent destination as if it worked", async () => {
    render(<Dashboard />);
    await screen.findByText("Profile setup editor");

    // Profile and AI Review need the profile this gate is asking for, so the
    // click resolves back to setup rather than rendering a page that cannot work.
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: "Style profile" }));
    expect(await screen.findByText("Profile setup editor")).toBeInTheDocument();
  });
});
