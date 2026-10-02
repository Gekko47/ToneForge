import { render, screen, waitFor } from "@testing-library/react";
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
import { TASKPANE_DESTINATIONS } from "../../../../src/taskpane/components/TaskPaneHeader";

/**
 * How long to wait for a lazily imported page.
 *
 * Every destination renders behind a `Suspense` fallback, so the first paint is
 * a "Loading..." element and the page arrives on a later tick. Testing Library
 * defaults to one second, which is enough in a plain run and not enough under
 * the coverage instrumentation the verification graph also runs. Settings is the
 * heaviest of them and was the one to fail. One test failing only in the
 * instrumented run is a flaky test, not a passing one, so the wait is stated once
 * here rather than tuned per assertion.
 */
const LAZY_PAGE = { timeout: 5000 } as const;

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

    expect(await screen.findByRole("heading", { name: "Settings" }, LAZY_PAGE)).toBeInTheDocument();
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
      await screen.findByRole("heading", { name: "Troubleshooting & diagnostics" }, LAZY_PAGE),
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

  /**
   * Every destination, not a list of the ones someone remembered.
   *
   * `DashboardWithoutProfile` renders a branch per destination and falls through to
   * Home for anything it has no branch for. `review` and `semantic-review` had
   * none, so choosing either — or arriving on Semantic Review and pressing Back —
   * landed on the setup checklist, which is indistinguishable from the press doing
   * nothing. It was reported from a real Word as the two pages "stuck showing what
   * the home page shows".
   *
   * Enumerated from `TASKPANE_DESTINATIONS` rather than written out here, so a
   * destination added to the drawer without a branch fails this test the day it is
   * added. A hand-written list would have gone stale in exactly the way the routing
   * did: correct when written, and quietly wrong after the next addition.
   *
   * `landing` is excluded because Home is the destination that legitimately is
   * Home.
   */
  it.each(
    TASKPANE_DESTINATIONS.filter(({ key }) => key !== "landing").map(({ key, label }) => ({
      key,
      label,
    })),
  )("renders its own page for $label with no profile", async ({ label }) => {
    render(<Dashboard />);
    await screen.findByTestId("tf-setup-deterministicProfile");

    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: label }));

    await waitFor(
      () => expect(screen.queryByTestId("tf-setup-deterministicProfile")).not.toBeInTheDocument(),
      LAZY_PAGE,
    );
  });

  it("reaches Semantic Review, which needs no deterministic profile at all", async () => {
    render(<Dashboard />);
    await screen.findByTestId("tf-setup-deterministicProfile");

    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: "Semantic Review" }));

    expect(
      await screen.findByRole("heading", { name: "Semantic Review" }, LAZY_PAGE),
    ).toBeInTheDocument();
  });

  it("reaches Deterministic Review and names the control that resolves the gap", async () => {
    /*
     * ADR-0069: a refusal names the control that resolves it. With no profile there
     * are no rules and no findings, so the honest page says that rather than
     * presenting an empty list as a clean document.
     */
    render(<Dashboard />);
    await screen.findByTestId("tf-setup-deterministicProfile");

    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: "Deterministic Review" }));

    expect(
      await screen.findByRole("heading", { name: "Deterministic Review" }, LAZY_PAGE),
    ).toBeInTheDocument();
    expect(screen.getByText(/No deterministic style profile is active/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deterministic Style Profile" })).toBeInTheDocument();
  });

  it("returns from Semantic Review to Deterministic Review, not to Home", async () => {
    /*
     * The reported path. The breadcrumb on the semantic page says "Back to
     * Deterministic Review", and it used to arrive at Home.
     */
    render(<Dashboard />);
    await screen.findByTestId("tf-setup-deterministicProfile");

    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: "Semantic Review" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Back to Deterministic Review" }, LAZY_PAGE),
    );

    expect(
      await screen.findByRole("heading", { name: "Deterministic Review" }, LAZY_PAGE),
    ).toBeInTheDocument();
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
