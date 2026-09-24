/**
 * Tests for sourceLocator.ts — navigateToFinding.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { navigateToFinding } from "../../../src/word/sourceLocator";
import { type Finding } from "../../../src/core/domain/Finding";

function mockOffice(_findings: Finding[] = []): void {
  (globalThis as { Office?: unknown }).Office = {
    run: <T>(func: (context: unknown) => Promise<T>): Promise<T> =>
      func({
        document: {
          body: {
            text: "The quick brown fox jumps over the lazy dog",
            load: vi.fn(),
            getRange: vi.fn(() => ({
              load: vi.fn(),
              set: vi.fn(),
              select: vi.fn(),
              highlight: { color: "" },
            })),
          },
          getSelection: vi.fn(() => ({
            load: vi.fn(),
            text: "",
          })),
        },
        host: { name: "Word", version: "16.0" },
        sync: vi.fn(),
      }),
    roamingSettings: {
      get: vi.fn(),
      set: vi.fn(),
      saveAsync: vi.fn((cb?: (result: unknown) => void) => {
        if (cb) cb(undefined);
      }),
    },
    InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
    BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
    InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "test-finding-001",
    kind: "deterministic",
    category: "typography.emDash",
    range: { start: 5, end: 15, unit: "character" },
    message: "Test finding",
    severity: "warning",
    evidence: "",
    nodeIds: ["abc123"],
    source: "deterministic",
    risk: "low",
    reversible: true,
    status: "new",
    confidence: 1,
    ...overrides,
  };
}

describe("navigateToFinding", () => {
  beforeEach(() => {
    mockOffice();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("navigates to a finding via nodeId path", async () => {
    const finding = makeFinding();
    const result = await navigateToFinding({ finding });
    expect(result.navigated).toBe(true);
    expect(result.method).toBe("nodeId");
    expect(result.message).toContain(finding.id);
  });

  it("navigates to a finding via character offsets", async () => {
    const finding = makeFinding({ nodeIds: [] });
    const result = await navigateToFinding({ finding });
    expect(result.navigated).toBe(true);
    expect(result.method).toBe("offsets");
  });

  it("returns unsupported when range is out of bounds", async () => {
    const finding = makeFinding({ range: { start: 0, end: 9999, unit: "character" } });
    const result = await navigateToFinding({ finding });
    expect(result.navigated).toBe(false);
    expect(result.method).toBe("unsupported");
  });

  it("handles navigation failure gracefully", async () => {
    (globalThis as { Office?: unknown }).Office = {
      run: async () => {
        throw new Error("Office not available");
      },
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0 },
      BreakType: { NextParagraph: 0 },
      InsertLocation: { Before: 0 },
    };

    const finding = makeFinding();
    const result = await navigateToFinding({ finding });
    expect(result.navigated).toBe(false);
    expect(result.method).toBe("unsupported");
  });

  it("supports highlight option", async () => {
    const finding = makeFinding();
    const result = await navigateToFinding({ finding, highlight: true });
    expect(result.navigated).toBe(true);
  });
});
