import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Whether an incremental scan is *narrower* is one decision; whether it is
 * *honest* is another, and this file pins both.
 *
 * The observer is mocked at its two boundaries — acquisition and the checker —
 * so these cases test the observer's own judgement rather than the rules. A
 * narrowing that examined the wrong nodes, or that reported a full scan while
 * examining three paragraphs, is the failure this whole item exists to prevent.
 */

const mocks = vi.hoisted(() => ({
  acquireAnalysisContext: vi.fn(),
  checkConsistency: vi.fn(),
}));

vi.mock("../../../src/word/analysisAcquisition", () => ({
  acquireAnalysisContext: mocks.acquireAnalysisContext,
}));

vi.mock("../../../src/analysis/consistencyChecker", () => ({
  checkConsistency: mocks.checkConsistency,
}));

import { createDocumentObserver } from "../../../src/word/documentObserver";
import { createEmptyProfile } from "../../../src/core/domain/StyleProfile";
import type { WordParagraphChange } from "../../../src/word/wordParagraphEvents";

const NODE_IDS = ["n1", "n2", "n3"];

function nodes() {
  return NODE_IDS.map((nodeId) => ({
    nodeId,
    type: "paragraph",
    text: `Body of ${nodeId}.`,
    editable: true,
    includedInGovernance: true,
    sourcePath: `body/${nodeId}`,
  }));
}

function context() {
  return {
    identity: {
      documentId: "doc-1",
      documentVersion: "v1",
      contentHash: "hash-1",
      structuralHash: "struct-1",
      capturedAt: new Date().toISOString(),
      fullText: "Body of n1. Body of n2. Body of n3.",
      analysisText: "Body of n1. Body of n2. Body of n3.",
    },
    text: "Body of n1. Body of n2. Body of n3.",
    nodes: nodes(),
    acquisition: { unsupported: [] as string[], structuralCoverage: "bodyText" },
  };
}

function change(overrides: Partial<WordParagraphChange> = {}): WordParagraphChange {
  return {
    kind: "changed",
    uniqueLocalIds: ["n2"],
    source: "local",
    requiresFullRescan: false,
    at: new Date().toISOString(),
    ...overrides,
  };
}

/** The options the observer passed to the checker on its most recent run. */
function lastCheck() {
  const call = mocks.checkConsistency.mock.calls.at(-1);
  if (call === undefined) throw new Error("no scan ran");
  return call[0] as {
    context: { nodes: ReadonlyArray<{ nodeId: string }> };
    examinedNodeIds?: string[];
    incremental?: boolean;
    incrementalReason?: string;
  };
}

/**
 * Run the observer's start scan, then the scan triggered by `payload`.
 *
 * `undefined` is a first-class case rather than an omitted argument: "the
 * caller knows nothing about what changed" is the default the Dashboard uses for
 * every trigger that is not a paragraph event, and it is the case that must
 * produce a full rescan.
 */
async function scan(payload: WordParagraphChange | undefined): Promise<void> {
  const observer = createDocumentObserver({
    debounceMs: 0,
    onStatus: () => undefined,
    profile: createEmptyProfile("Test"),
  });
  observer.startObserver();
  // The start scan is the baseline; the change under test is the second one.
  await flush();
  mocks.checkConsistency.mockClear();
  observer.onDocumentChanged(payload);
  await flush();
  observer.stopObserver();
}

/** Let the zero-delay debounce and the awaited scan settle. */
async function flush(): Promise<void> {
  await Promise.all(
    Array.from({ length: 12 }, () => new Promise((resolve) => setTimeout(resolve, 0))),
  );
}

describe("incremental scan scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireAnalysisContext.mockImplementation(async () => context());
    mocks.checkConsistency.mockImplementation(async () => ({
      findings: [],
      coverage: {
        complete: true,
        examinedNodeIds: NODE_IDS,
        counts: [],
        processedCharacterCount: 0,
        revisedCharacterCount: 0,
        excluded: [],
        unprocessed: [],
        plannedChangeCount: 0,
        appliedChangeCount: 0,
        changedNodeIds: [],
      },
    }));
  });

  it("examines only the paragraph Word reported as changed", async () => {
    await scan(change());
    expect(lastCheck().context.nodes.map((node) => node.nodeId)).toEqual(["n2"]);
    expect(lastCheck().examinedNodeIds).toEqual(["n2"]);
  });

  it("says the run was partial and names the shortfall", async () => {
    // The report has to state what it skipped. A narrowed run that reads as a
    // whole-document one is worse than a slow one.
    await scan(change());
    expect(lastCheck().incremental).toBe(true);
    expect(lastCheck().incrementalReason).toMatch(/examined 1 of 3/);
  });

  it("examines the whole document when no change payload is supplied", async () => {
    await scan(undefined);
    expect(lastCheck().context.nodes.map((node) => node.nodeId)).toEqual(NODE_IDS);
    expect(lastCheck().incremental).toBeUndefined();
  });

  it("falls back to a full rescan when the host could not name every id", async () => {
    // `requiresFullRescan` means ids were dropped. Trusting a known-incomplete
    // set is how a paragraph silently goes unexamined.
    await scan(change({ requiresFullRescan: true }));
    expect(lastCheck().context.nodes.map((node) => node.nodeId)).toEqual(NODE_IDS);
    expect(lastCheck().incremental).toBeUndefined();
  });

  it("falls back to a full rescan for a deletion", async () => {
    // A removed paragraph shifts every index and range after it, and the event
    // names what went rather than what moved.
    await scan(change({ kind: "deleted" }));
    expect(lastCheck().context.nodes.map((node) => node.nodeId)).toEqual(NODE_IDS);
  });

  it("falls back to a full rescan for a remote edit", async () => {
    // A collaborator's change may have touched anything in the document.
    await scan(change({ source: "remote" }));
    expect(lastCheck().context.nodes.map((node) => node.nodeId)).toEqual(NODE_IDS);
  });

  it("falls back to a full rescan for an event naming no paragraphs", async () => {
    await scan(change({ uniqueLocalIds: [] }));
    expect(lastCheck().context.nodes.map((node) => node.nodeId)).toEqual(NODE_IDS);
  });

  it("falls back to a full rescan when the named ids are not in the document", async () => {
    // An event naming ids the host no longer has names nothing we can read.
    await scan(change({ uniqueLocalIds: ["gone-1"] }));
    expect(lastCheck().context.nodes.map((node) => node.nodeId)).toEqual(NODE_IDS);
    expect(lastCheck().incremental).toBeUndefined();
  });

  it("examines the whole document when the event names all of it", async () => {
    // Not a partial run, so it must not be labelled one.
    await scan(change({ uniqueLocalIds: NODE_IDS }));
    expect(lastCheck().context.nodes.map((node) => node.nodeId)).toEqual(NODE_IDS);
    expect(lastCheck().incremental).toBeUndefined();
  });

  it("examines every node a burst named, not only the last", async () => {
    // Two paragraphs edited inside one debounce window both need examining;
    // keeping only the most recent would silently skip the first.
    const observer = createDocumentObserver({
      debounceMs: 5,
      onStatus: () => undefined,
      profile: createEmptyProfile("Test"),
    });
    observer.startObserver();
    await new Promise((resolve) => setTimeout(resolve, 20));
    mocks.checkConsistency.mockClear();

    observer.onDocumentChanged(change({ uniqueLocalIds: ["n1"] }));
    observer.onDocumentChanged(change({ uniqueLocalIds: ["n3"] }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    observer.stopObserver();

    expect(
      lastCheck()
        .context.nodes.map((node) => node.nodeId)
        .sort(),
    ).toEqual(["n1", "n3"]);
  });

  it("widens to a full rescan when an imprecise event follows a precise one", async () => {
    // The reverse order of the case above. A full rescan must win: an earlier
    // narrow scope cannot be allowed to constrain it.
    const observer = createDocumentObserver({
      debounceMs: 5,
      onStatus: () => undefined,
      profile: createEmptyProfile("Test"),
    });
    observer.startObserver();
    await new Promise((resolve) => setTimeout(resolve, 20));
    mocks.checkConsistency.mockClear();

    observer.onDocumentChanged(change({ uniqueLocalIds: ["n1"] }));
    observer.onDocumentChanged(change({ requiresFullRescan: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    observer.stopObserver();

    expect(lastCheck().context.nodes.map((node) => node.nodeId)).toEqual(NODE_IDS);
  });
});
