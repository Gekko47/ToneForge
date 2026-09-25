import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/core/state/persistence", () => ({
  loadState: vi.fn(() => ({
    version: 5,
    profiles: [],
    profileHistory: {},
    activeProfileId: null,
    governanceProfiles: {},
    governanceHistory: {},
    activeGovernanceProfileId: null,
    settings: {
      llmProvider: "mock",
      openAiCredentialMode: "broker",
      spotReviewConsent: false,
      fullDocumentReviewConsent: false,
      semanticOptIn: false,
      telemetryDisabled: true,
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
});
