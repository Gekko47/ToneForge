import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessCapabilityEvidence,
  compareRequirementSets,
  paragraphEventRequirementMet,
} from "../../../src/word/capabilityEvidence";
import {
  createWordParagraphEventAdapter,
  normalizeParagraphEvent,
  paragraphEventEvidence,
  type WordParagraphChange,
} from "../../../src/word/wordParagraphEvents";

afterEach(() => {
  delete (globalThis as { Office?: unknown }).Office;
});

function installEventHost(): {
  handlers: Map<string, (event: { uniqueLocalIds: string[]; source: string }) => void>;
  removed: string[];
} {
  const handlers = new Map<string, (event: { uniqueLocalIds: string[]; source: string }) => void>();
  const removed: string[] = [];
  const source = (name: string) => ({
    add: (handler: (event: { uniqueLocalIds: string[]; source: string }) => void) => {
      handlers.set(name, handler);
      return {
        remove: () => {
          removed.push(name);
          handlers.delete(name);
        },
      };
    },
  });
  (globalThis as { Office?: unknown }).Office = {
    run: async (func: (context: unknown) => Promise<unknown>) =>
      func({
        document: {
          onParagraphAdded: source("added"),
          onParagraphChanged: source("changed"),
          onParagraphDeleted: source("deleted"),
        },
        sync: async () => undefined,
      }),
  };
  return { handlers, removed };
}

describe("capability evidence", () => {
  it("orders evidence tiers and requirement sets", () => {
    expect(
      assessCapabilityEvidence({
        capability: "x",
        apiPresent: false,
        hostTested: false,
        releaseSupported: false,
      }).tier,
    ).toBe("unsupported");
    expect(
      assessCapabilityEvidence({
        capability: "x",
        apiPresent: true,
        hostTested: true,
        releaseSupported: false,
      }).tier,
    ).toBe("host-tested");
    expect(
      assessCapabilityEvidence({
        capability: "x",
        apiPresent: true,
        hostTested: true,
        releaseSupported: true,
      }).tier,
    ).toBe("release-supported");
    expect(compareRequirementSets("1.10", "1.6")).toBeGreaterThan(0);
    expect(paragraphEventRequirementMet("1.5")).toBe(false);
    expect(paragraphEventRequirementMet(null)).toBe(false);
    expect(
      paragraphEventEvidence({
        apiPresent: true,
        requirementSet: "1.6",
        hostTested: false,
        releaseSupported: false,
      }).tier,
    ).toBe("api-present");
  });
});

describe("word paragraph events", () => {
  it("normalizes identifiers and flags unusable events for full rescan", () => {
    const change = normalizeParagraphEvent(
      "changed",
      { uniqueLocalIds: ["A-1", "a-1", "  ", 5], source: "remote" },
      "2026-01-01T00:00:00.000Z",
    );
    expect(change.uniqueLocalIds).toEqual(["a-1"]);
    expect(change.requiresFullRescan).toBe(true);
    expect(change.source).toBe("remote");
  });

  it("registers, dispatches, and removes every handler", async () => {
    const host = installEventHost();
    const onChange = vi.fn<(change: WordParagraphChange) => void>();
    const adapter = createWordParagraphEventAdapter({ onChange });

    expect(await adapter.start()).toBe(true);
    expect(adapter.isRegistered()).toBe(true);
    host.handlers.get("changed")?.({ uniqueLocalIds: ["b-2"], source: "local" });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "changed", uniqueLocalIds: ["b-2"] }),
    );

    adapter.stop();
    expect(adapter.isRegistered()).toBe(false);
    expect(host.removed.sort()).toEqual(["added", "changed", "deleted"]);
  });

  it("returns false and keeps the conservative path when events are absent", async () => {
    (globalThis as { Office?: unknown }).Office = {
      run: async (func: (context: unknown) => Promise<unknown>) =>
        func({ document: {}, sync: async () => undefined }),
    };
    const adapter = createWordParagraphEventAdapter({ onChange: vi.fn() });
    expect(await adapter.start()).toBe(false);
    expect(adapter.lastError()).toContain("does not expose paragraph events");
  });
});
