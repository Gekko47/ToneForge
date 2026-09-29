import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
// A type-only namespace import, not an inline `import()` annotation: the lint
// rule forbids the latter, and the type is erased at build time so the hoisted
// `vi.mock` factory below still sees a clean module scope.
import type * as PersistenceModule from "../../../../src/core/state/persistence";

/**
 * First run reports; it does not lock.
 *
 * The pane used to return a `NoProfileSetup` component whose `navigate` collapsed
 * every destination except Settings, Troubleshooting, and home back to home —
 * where home *was* the profile editor. The header's Semantic, Consistency, and
 * Governance Policy items were therefore visible and inert, and the only way to
 * read the AI consent, change the theme, or inspect Troubleshooting was to create
 * a profile first. A user whose document was too short to sample had no way to
 * create the blank profile that would unblock them at all.
 *
 * The prerequisite itself is unchanged and still enforced: scanning and applying
 * need a deterministic profile. What changed is that the answer to "may I leave
 * this page" is no longer "no".
 */
vi.mock("../../../../src/core/state/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof PersistenceModule>();
  return {
    ...actual,
    loadState: vi.fn(() => ({
      ...actual.loadState(),
      activeProfileId: null,
      activeSemanticProfileId: null,
      settings: { llmProvider: "mock", openAiCredentialMode: "broker", semanticOptIn: false },
    })),
  };
});

vi.mock("../../../../src/taskpane/pages/Profile", () => ({
  default: function ProfileSetup(): React.ReactNode {
    return <div>Profile setup editor</div>;
  },
}));

import Dashboard from "../../../../src/taskpane/pages/Dashboard";

describe("Dashboard first-run state", () => {
  it("states what a missing profile prevents, instead of locking the pane", async () => {
    render(<Dashboard />);

    // The checklist row, not a wall.
    expect(await screen.findByTestId("tf-setup-deterministicProfile")).toBeInTheDocument();
    expect(
      screen.getByText(/Scanning this document and applying corrections are unavailable/),
    ).toBeInTheDocument();
  });

  it("keeps navigation available before a profile exists", async () => {
    render(<Dashboard />);
    await screen.findByTestId("tf-setup-deterministicProfile");

    expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
  });

  it("reaches Settings from the first-run state", async () => {
    render(<Dashboard />);
    await screen.findByTestId("tf-setup-deterministicProfile");

    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  /**
   * The regression this whole change exists for. The old behaviour redirected
   * this click back to the profile editor, which is indistinguishable from the
   * navigation item being broken.
   */
  it("reaches a destination that does not need a profile", async () => {
    render(<Dashboard />);
    await screen.findByTestId("tf-setup-deterministicProfile");

    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: "Troubleshooting" }));

    expect(
      await screen.findByRole("heading", { name: "Troubleshooting & diagnostics" }),
    ).toBeInTheDocument();
  });

  it("reaches the profile editor itself, from its own checklist row", async () => {
    render(<Dashboard />);
    await screen.findByTestId("tf-setup-deterministicProfile");

    await userEvent.click(
      screen.getByRole("button", { name: /Set up deterministic style profile/ }),
    );

    expect(await screen.findByText("Profile setup editor")).toBeInTheDocument();
  });

  it("does not claim a missing provider blocks deterministic work", async () => {
    /*
     * The deterministic engine calls no model, so a missing provider blocks
     * exactly the AI surfaces. Claiming otherwise teaches a user that the tool is
     * broken when the parts they are using work fine.
     */
    render(<Dashboard />);
    await screen.findByTestId("tf-setup-llmProvider");

    expect(
      screen.getByText(/Deterministic review, scanning, and applying corrections are unaffected/),
    ).toBeInTheDocument();
  });
});
