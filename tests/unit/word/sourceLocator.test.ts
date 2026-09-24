/**
 * Tests for sourceLocator.ts — navigateToFinding.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { navigateToFinding } from "../../../src/word/sourceLocator";
import { type Finding } from "../../../src/core/domain/Finding";

let rangeMock: {
  load: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  highlight: { color: string };
};

function mockOffice(_findings: Finding[] = []): void {
  rangeMock = {
    load: vi.fn(),
    set: vi.fn(),
    select: vi.fn(),
    highlight: { color: "" },
  };
  (globalThis as { Office?: unknown }).Office = {
    run: vi.fn(<T>(func: (context: unknown) => Promise<T>): Promise<T> =>
      func({
        document: {
          body: {
            text: "The quick brown fox jumps over the lazy dog",
            load: vi.fn(),
            getRange: vi.fn(() => rangeMock),
          },
          getSelection: vi.fn(() => ({
            load: vi.fn(),
            text: "",
          })),
        },
        host: { name: "Word", version: "16.0" },
        sync: vi.fn(),
      }),
    ),
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

  it("navigates to a finding by narrowing the documented whole-body range", async () => {
    const finding = makeFinding();
    const result = await navigateToFinding({ finding });
    expect(result.navigated).toBe(true);
    expect(result.method).toBe("nodeId");
    expect(result.message).toContain(finding.id);
    const office = (globalThis as unknown as { Office: { run: ReturnType<typeof vi.fn> } }).Office;
    expect(office.run).toHaveBeenCalledTimes(1);
    expect(rangeMock.set).toHaveBeenCalledWith({ start: 5, end: 15 });
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

  it("fails closed when the host cannot narrow the body range", async () => {
    const office = (globalThis as unknown as { Office: { run: ReturnType<typeof vi.fn> } }).Office;
    office.run.mockImplementation(async (func: (context: unknown) => Promise<unknown>) =>
      func({
        document: {
          body: {
            text: "short",
            load: vi.fn(),
            getRange: () => ({ select: vi.fn() }),
          },
        },
        sync: vi.fn(),
      }),
    );
    const result = await navigateToFinding({
      finding: makeFinding({ range: { start: 0, end: 1, unit: "character" } }),
    });
    expect(result).toMatchObject({ navigated: false, method: "unsupported" });
  });

  it("supports highlight option", async () => {
    const finding = makeFinding();
    const result = await navigateToFinding({ finding, highlight: true });
    expect(result.navigated).toBe(true);
  });
});
