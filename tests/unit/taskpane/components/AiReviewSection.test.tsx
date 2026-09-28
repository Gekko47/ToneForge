import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AiReviewSection, {
  aiReviewBlocker,
} from "../../../../src/taskpane/components/AiReviewSection";

function renderSection(overrides: Partial<React.ComponentProps<typeof AiReviewSection>> = {}) {
  const props: React.ComponentProps<typeof AiReviewSection> = {
    stage: "idle",
    providerConfigured: true,
    hasConsent: true,
    providerName: "mock",
    preflight: null,
    progress: null,
    cancelled: false,
    result: null,
    message: null,
    onOpenSettings: vi.fn(),
    onStart: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    onCancelRun: vi.fn(),
    onReviewFindings: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<AiReviewSection {...props} />) };
}

describe("AiReviewSection", () => {
  it("presents one review with one heading and one action", () => {
    renderSection();
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings).toHaveLength(1);
    // Named for what it does, and matching the consent it is gated on, which is
    // `consistencyReviewConsent`. "AI Review" described the mechanism rather than
    // the check, and invited the reading that some other review was elsewhere.
    expect(headings[0]).toHaveTextContent("Consistency Review");
    // Exactly one trigger. The page used to offer three buttons, each carrying
    // its own copy of the same consent sentence.
    expect(screen.getAllByRole("button", { name: "Check Consistency" })).toHaveLength(1);
  });

  it("states the missing consent once and links to Settings", () => {
    const onOpenSettings = vi.fn();
    renderSection({ hasConsent: false, onOpenSettings });
    const blocker = screen.getByTestId("ai-review-blocker");
    expect(blocker).toHaveTextContent(/needs its own consent/i);
    expect(
      screen.getAllByText(/needs its own consent in Settings before any document text can be sent/),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeInTheDocument();
  });

  it("disables the action while a prerequisite is missing", () => {
    renderSection({ providerConfigured: false });
    expect(screen.getByRole("button", { name: "Check Consistency" })).toBeDisabled();
  });

  it("prefers the consent prerequisite over the provider prerequisite", () => {
    expect(
      aiReviewBlocker({ hasConsent: false, providerConfigured: false, onOpenSettings: vi.fn() })
        ?.message,
    ).toMatch(/consent/i);
    expect(
      aiReviewBlocker({ hasConsent: true, providerConfigured: false, onOpenSettings: vi.fn() })
        ?.message,
    ).toMatch(/provider/i);
    expect(
      aiReviewBlocker({ hasConsent: true, providerConfigured: true, onOpenSettings: vi.fn() }),
    ).toBeNull();
  });

  it("shows the preflight instead of the trigger once a review is being started", () => {
    renderSection({ stage: "preflight", preflight: { wordCount: 900, statementCount: 12 } });
    expect(screen.queryByRole("button", { name: /review this document/i })).not.toBeInTheDocument();
    expect(screen.getByText(/900/)).toBeInTheDocument();
  });
});
