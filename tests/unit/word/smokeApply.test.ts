import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  applySmokePlan,
  buildDemoChangePlan,
  enableSmokeMutations,
} from "../../../src/word/smokeApply";
import { STAGE_01_PASSED, setStage01Passed } from "../../../src/word/revisionAdapter";
import type { WordCapabilities } from "../../../src/word/capabilityProbe";

const FULL_CAPABILITIES: WordCapabilities = {
  supportsInsertText: true,
  supportsReplaceText: true,
  supportsInsertParagraph: true,
  supportsInsertBreak: true,
  supportsStyles: true,
  supportsRevisions: true,
  hostName: "Word",
  hostVersion: "16.0",
};

function makeRangeMock() {
  return {
    text: "",
    insertText: vi.fn(function (this: unknown) {
      return this;
    }),
    insertBreak: vi.fn(),
    insertParagraph: vi.fn(() => ({ format: {}, load: vi.fn() })),
    paragraphs: { load: vi.fn(), items: [] },
    font: { name: "", size: 0, color: "", load: vi.fn(), set: vi.fn() },
    paragraphFormat: { set: vi.fn() },
    listFormat: { set: vi.fn() },
    style: "",
    set: vi.fn(function (this: unknown) {
      return this;
    }),
    load: vi.fn(),
  };
}

function installSmokeOffice(bodyText: string) {
  const rangeMock = makeRangeMock();
  const sharedDoc: Record<string, unknown> = {
    load: vi.fn(),
    changeTrackingMode: "Off",
  };
  const body = {
    text: bodyText,
    load: vi.fn(),
    getRange: vi.fn(() => rangeMock),
    getTrackedChanges: vi.fn(() => ({ load: vi.fn(), items: [{}] })),
  };
  sharedDoc["body"] = body;
  sharedDoc["getSelection"] = vi.fn(() => ({ getRange: vi.fn(() => rangeMock) }));
  sharedDoc["styles"] = { load: vi.fn(), items: [] };
  (globalThis as { Office?: unknown }).Office = {
    run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> =>
      func({
        document: sharedDoc,
        host: { name: "Word", version: "16.0" },
        sync: vi.fn(),
      }),
    roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
    InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
    BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
    InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
  };
  return { rangeMock, sharedDoc };
}

describe("smokeApply", () => {
  let originalOffice: unknown;

  beforeEach(() => {
    originalOffice = (globalThis as { Office?: unknown }).Office;
    setStage01Passed(false);
  });

  afterEach(() => {
    (globalThis as { Office?: unknown }).Office = originalOffice;
    setStage01Passed(false);
    vi.restoreAllMocks();
  });

  it("enableSmokeMutations flips the Stage 01 gate with a snapshot", () => {
    expect(STAGE_01_PASSED).toBe(false);
    enableSmokeMutations(FULL_CAPABILITIES);
    expect(STAGE_01_PASSED).toBe(true);
  });

  it("builds a single-insert demo plan for an empty document", async () => {
    installSmokeOffice("");

    const { plan, summary } = await buildDemoChangePlan();

    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]?.type).toBe("insertText");
    expect(summary).toHaveLength(1);
  });

  it("builds an insert-plus-replace demo plan for a non-empty document", async () => {
    installSmokeOffice("hello world");

    const { plan, summary } = await buildDemoChangePlan();

    expect(plan.changes).toHaveLength(2);
    expect(plan.changes.map((change) => change.type).sort()).toEqual(["insertText", "replaceText"]);
    expect(summary).toHaveLength(2);
  });

  it("applies a demo plan with tracking managed", async () => {
    installSmokeOffice("hello world");
    enableSmokeMutations(FULL_CAPABILITIES);

    const { plan } = await buildDemoChangePlan();
    const { results, tracking } = await applySmokePlan(plan, plan.docHash);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.applied)).toBe(true);
    expect(tracking.managed).toBe(true);
    expect(tracking.modeBefore).toBe("Off");
    expect(tracking.modeAfter).toBe("Off");
    expect(tracking.recordedCount).toBe(1);
  });

  it("refuses a stale demo plan instead of corrupting the document", async () => {
    installSmokeOffice("hello world");
    enableSmokeMutations(FULL_CAPABILITIES);

    const { plan } = await buildDemoChangePlan();
    const { results } = await applySmokePlan(plan, "stale-hash");

    expect(results.every((result) => !result.applied)).toBe(true);
    expect(results[0]?.error).toContain("hash mismatch");
  });
});
