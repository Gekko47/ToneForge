/**
 * One h1 per pane (ADR-0138).
 *
 * The header used to render `<h1>ToneForge</h1>` on every page, and each page
 * rendered its own `<h1 className="tf-title">Page Title</h1>` beneath it. Two
 * h1s per pane meant a screen reader announced the product name before the
 * page title, and the product name outranked the page title visually.
 *
 * The fix promotes the page title into the header and removes the brand title.
 * This test is the structural guard: it renders the full pane and asserts
 * exactly one h1, with the page title as its text.
 *
 * A source-level scan is not enough — a page could render zero h1s and the
 * header could render one, which would pass a source scan while leaving the
 * page title absent from the accessibility tree. So this renders the real
 * component tree and counts.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/state/persistence", () => ({
  loadState: () => ({
    version: 13,
    profileRecords: {},
    activeProfileId: null,
    semanticProfileRecords: {},
    activeSemanticProfileId: null,
    ignoredFindings: [],
    reviewedFindings: [],
    governanceProfiles: {},
    governanceHistory: {},
    activeGovernanceProfileId: null,
    settings: {
      llmProvider: "mock" as const,
      openAiCredentialMode: "broker" as const,
      semanticOptIn: false,
    },
    providerConnections: [],
  }),
  saveState: vi.fn(),
  subscribeToState: () => () => undefined,
}));

vi.mock("../../../src/core/state", () => ({
  loadState: () => ({
    version: 13,
    profileRecords: {},
    activeProfileId: null,
    semanticProfileRecords: {},
    activeSemanticProfileId: null,
    ignoredFindings: [],
    reviewedFindings: [],
    governanceProfiles: {},
    governanceHistory: {},
    activeGovernanceProfileId: null,
    settings: {
      llmProvider: "mock" as const,
      openAiCredentialMode: "broker" as const,
      semanticOptIn: false,
    },
    providerConnections: [],
  }),
  saveState: vi.fn(),
  subscribeToState: () => () => undefined,
}));

import Dashboard from "../../../src/taskpane/pages/Dashboard";

describe("one h1 per pane (ADR-0138)", () => {
  it("renders exactly one h1, with the page title as its text", () => {
    render(<Dashboard initialPage="review" />);

    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Deterministic Review");
  });

  it("does not render the brand title as a heading", () => {
    render(<Dashboard initialPage="review" />);

    // The product name may appear in the navigation drawer, but not as a heading.
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s.some((h) => h.textContent === "ToneForge")).toBe(false);
  });
});
