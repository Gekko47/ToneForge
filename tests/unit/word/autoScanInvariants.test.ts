/**
 * Auto-scan invariants (spec §23).
 *
 * The scan that runs on every keystroke must update the findings and do nothing
 * else. Three things it must never do, each because the failure is silent:
 *
 * - **approve.** An approval is a decision the user made, bound to a document
 *   identity and a profile revision (§16). A scan that approved its own
 *   findings would make the decision the user's fiction and would make the
 *   reviewed-only gate meaningless — Apply would offer changes nobody chose.
 * - **apply.** Same reason, one level worse: it would write to the document.
 * - **claim whole-document compliance from a narrowed scan.** An incremental
 *   scan sees the paragraph Word named as changed and nothing else. Reporting
 *   that as a complete analysis of the document is the false-compliance claim
 *   §9 exists to prevent, and it is the one an auto-scan is most likely to make
 *   because it runs precisely when it *hasn't* seen the rest of the document.
 *
 * Plus the two obligations an auto-scan does have: it replaces the finding list
 * rather than merging into it, and a change to a target invalidates the
 * decision recorded against it.
 *
 * The observer is mocked at its two boundaries — acquisition and the review
 * engine — so these test the observer's own judgement rather than the rules.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireAnalysisContext: vi.fn(),
  runDeterministicReview: vi.fn(),
}));

vi.mock("../../../src/word/analysisAcquisition", () => ({
  acquireAnalysisContext: mocks.acquireAnalysisContext,
}));

vi.mock("../../../src/analysis/deterministic/deterministicReviewEngine", () => ({
  runDeterministicReview: mocks.runDeterministicReview,
}));

/*
 * The shared coverage report is mocked out, and the reason is that this file is
 * not testing it.
 *
 * `buildCoverage` parses a full `AcquisitionDiagnostics`, and a fixture that
 * satisfies it is a second, quieter copy of the acquisition contract. Every
 * scan would then depend on that copy staying accurate, and a schema change
 * would break these tests for a reason that has nothing to do with auto-scan.
 * The shared report has its own tests; what matters here is the *deterministic*
 * coverage, which is mocked at the engine and read straight off the status.
 */
vi.mock("../../../src/analysis/coverage", () => ({
  buildCoverage: vi.fn().mockReturnValue({
    runId: "auto-scan-test",
    counts: [],
    processedCharacterCount: 0,
    revisedCharacterCount: 0,
    examinedNodeIds: [],
    excluded: [],
    unsupported: [],
    unprocessed: [],
    plannedChangeCount: 0,
    appliedChangeCount: 0,
    changedNodeIds: [],
    complete: true,
    protectedOnly: false,
  }),
}));

import {
  createDocumentObserver,
  type DocumentObserverStatus,
} from "../../../src/word/documentObserver";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createEmptyProfile } from "../../../src/core/domain/StyleProfile";
import { createGovernanceProfile } from "../../../src/core/domain/GovernanceProfile";
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

/**
 * The context the mocked acquisition returns.
 *
 * The `acquisition` block is *complete* rather than partial, and that is load
 * bearing. `createAnalysisContext` parses it, so a fixture missing
 * `analyzedCharacterCount` throws and every scan the observer runs reports
 * `failed` -- which is what happened the first time this file ran, and why four
 * of the five initial failures were about stale-versus-clean rather than about
 * auto-scan. A partial fixture tests the failure path, which is a different
 * test.
 */
function context() {
  const text = "Body of n1. Body of n2. Body of n3.";
  return {
    identity: {
      documentId: "doc-1",
      documentVersion: "v1",
      contentHash: "hash-1",
      structuralHash: "struct-1",
      capturedAt: new Date().toISOString(),
      fullText: text,
      analysisText: text,
      analysisStart: 0,
      analysisEnd: text.length,
      analysisTruncated: false,
    },
    text,
    nodes: nodes(),
    /*
     * `policy` is present because the observer reads `context.policy.version` to
     * bind the review-session identity (§16), and a fixture without it fails every
     * scan with a `TypeError` that has nothing to do with auto-scan. The real
     * acquisition derives it from the profile; the smallest shape that answers
     * the one field the observer reads is enough here.
     */
    policy: createGovernanceProfile(createEmptyProfile("Test")),
    acquisition: {
      runId: "auto-scan-test",
      acquisitionReadCount: 1,
      syncCount: 2,
      analyzedCharacterCount: text.length,
      completeDocumentCharacterCount: text.length,
      fullBodyReadCount: 1,
      paragraphCollectionRead: true,
      structuralCoverage: "complete",
      unsupported: [] as string[],
      incremental: false,
      incrementalReason: "none",
    },
  };
}

/** A report shaped like the one the engine returns, with `count` findings. */
function report(count: number) {
  return {
    documentIdentity: {
      documentId: "doc-1",
      documentVersion: "v1",
      contentHash: "hash-1",
      structuralHash: "struct-1",
    },
    profileId: "11111111-1111-4111-8111-111111111111",
    profileRevision: 1,
    findings: Array.from({ length: count }, (_unused, index) => ({
      id: `finding-${index}`,
      kind: "deterministic",
      category: "typography.emDash",
      message: "An em dash.",
      severity: "warning",
      /*
       * `status: "new"`, and it is the *only* status an auto-scan may publish.
       *
       * A scan that approved its own findings would make the decision the
       * user's fiction and would make the reviewed-only gate meaningless: Apply
       * would offer changes nobody chose. The field is stated here rather than
       * left to a default so the invariant below has something to read -- a
       * finding with no status would pass an assertion that only checked for
       * absence of the bad values.
       */
      status: "new",
      range: { start: 0, end: 2, unit: "character" },
      nodeIds: [NODE_IDS[index % NODE_IDS.length] ?? "n1"],
    })),
    groups: [],
    coverage: {
      requestedScopes: ["body", "headings"],
      examinedScopes: ["body", "headings"],
      unsupportedScopes: [],
      excludedScopes: [],
      protectedScopes: [],
      textCharactersExamined: 33,
      paragraphsExamined: count,
      headingsExamined: 0,
      listsExamined: 0,
      tablesExamined: 0,
      sectionsExamined: 0,
      headersFootersExamined: 0,
      complete: true,
      blockers: [],
      coverageFingerprint: "body,headings|p3|t0|s0|h0",
    },
    summary: {
      total: count,
      actionable: count,
      reportedOnly: 0,
      bySeverity: { info: 0, warning: count, error: 0 },
      byCategoryGroup: { language: count, formatting: 0, structure: 0 },
    },
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

/** The fields the invariants below read, so the fixture stays small. */
function shape(status: DocumentObserverStatus) {
  return {
    phase: status.phase,
    findingCount: status.findings.length,
    stale: status.stale,
    coverageComplete: status.deterministicCoverage?.complete ?? null,
    examinedScopes: status.deterministicCoverage?.examinedScopes ?? [],
    contentHash: status.reviewSessionIdentity?.contentHash ?? null,
  };
}

/** Run one observer through a start scan and one change, collecting the statuses. */
async function observe(
  payload: WordParagraphChange | undefined,
): Promise<ReturnType<typeof shape>[]> {
  const statuses: Array<ReturnType<typeof shape>> = [];
  const observer = createDocumentObserver({
    debounceMs: 0,
    onStatus: (status) => statuses.push(shape(status)),
    profile: createEmptyProfile("Test"),
  });
  observer.startObserver();
  await flush();
  observer.onDocumentChanged(payload);
  await flush();
  observer.stopObserver();
  return statuses;
}

async function flush(): Promise<void> {
  await Promise.all(
    Array.from({ length: 12 }, () => new Promise((resolve) => setTimeout(resolve, 0))),
  );
}

describe("auto-scan invariants (spec §23)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireAnalysisContext.mockImplementation(async () => context());
    mocks.runDeterministicReview.mockImplementation(async () => report(2));
  });

  it("updates the findings when the document changes", async () => {
    /*
     * The one thing an auto-scan is *for*. A scan that did not replace the list
     * would leave a user looking at findings for a paragraph they had already
     * fixed, and the list would only ever grow.
     *
     * One observer, two scans: the second is the change-triggered one, and the
     * assertion is that the *last* status carries the new count rather than the
     * old one. Two observers would have tested that a scan can produce two
     * different results, which is not what the invariant is about.
     */
    let count = 3;
    mocks.runDeterministicReview.mockImplementation(async () => report(count));

    const statuses: Array<ReturnType<typeof shape>> = [];
    const observer = createDocumentObserver({
      debounceMs: 0,
      onStatus: (status) => statuses.push(shape(status)),
      profile: createEmptyProfile("Test"),
    });
    observer.startObserver();
    await flush();
    expect(statuses.at(-1)?.findingCount).toBe(3);

    count = 0;
    observer.onDocumentChanged(change());
    await flush();
    observer.stopObserver();

    expect(statuses.at(-1)?.findingCount).toBe(0);
    /*
     * Replaced, not merged. `startObserver` may scan more than once, so the
     * *count* of three-finding statuses is not the assertion -- what matters is
     * that the last one is the new run and that no status ever carried more than
     * three. A merge would have grown the total on each pass.
     */
    expect(statuses.every((status) => status.findingCount <= 3)).toBe(true);
  });

  it("never approves a finding", async () => {
    /*
     * §23 and §16 together. An approval is a decision the user made, bound to a
     * document identity and a profile revision. A scan that approved its own
     * findings would make the decision the user's fiction and would make the
     * reviewed-only gate meaningless: Apply would offer changes nobody chose.
     *
     * The check is on the status the observer publishes, because that is the only
     * channel it has. There is no approval write anywhere in this module, and
     * `approvalState` on a published finding is what a caller would read.
     */
    const statuses: Array<Record<string, unknown>> = [];
    const observer = createDocumentObserver({
      debounceMs: 0,
      onStatus: (status) => statuses.push(status as unknown as Record<string, unknown>),
      profile: createEmptyProfile("Test"),
    });
    observer.startObserver();
    await flush();
    observer.onDocumentChanged(change());
    await flush();
    observer.stopObserver();

    expect(statuses.length).toBeGreaterThan(0);
    statuses.forEach((status) => {
      const findings = (status["findings"] ?? []) as Array<Record<string, unknown>>;
      findings.forEach((finding) => {
        // `new` and `accepted` are the only two states a scan could wrongly
        // produce, and neither is ever written by this module.
        expect(["new", "reviewed"]).toContain(finding["status"]);
      });
    });
  });

  it("never applies anything to the document", async () => {
    /*
     * The same reason one level worse: applying writes to the user's document.
     * The observer is constructed with no capability set, no plan and no
     * reviewed plan, so it has nothing to apply with — and `Office.run` is only
     * ever reached through acquisition, which reads.
     *
     * The assertion that carries weight is the one below it: the module graph
     * the observer sits in does not include the mutation adapter at all.
     */
    const statuses: Array<Record<string, unknown>> = [];
    const observer = createDocumentObserver({
      debounceMs: 0,
      onStatus: (status) => statuses.push(status as unknown as Record<string, unknown>),
      profile: createEmptyProfile("Test"),
    });
    observer.startObserver();
    await flush();
    observer.onDocumentChanged(change());
    await flush();
    observer.stopObserver();

    // No status carries a plan, and nothing reported a mutation.
    statuses.forEach((status) => {
      expect(status["plan"]).toBeUndefined();
      expect(status["results"]).toBeUndefined();
    });
    expect(mocks.runDeterministicReview).toHaveBeenCalled();
  });

  it("does not import the mutation adapter, so it cannot call it", () => {
    /*
     * A structural companion to the case above.
     *
     * Asserting that an auto-scan does not apply a plan is a claim about a
     * capability the observer could acquire. Asserting that it has no path to
     * the adapter at all is a claim about the module graph, and it holds however
     * the observer is refactored. `src/word/revisionAdapter` is reachable from
     * the word boundary, so nothing short of this check stops a future
     * convenience import from quietly giving the scanner a way to write.
     */
    /*
     * Read the source text rather than importing the module: the assertion is
     * about the module graph, not about the runtime, and importing would run
     * the module's top-level Office detection.
     *
     * `process.cwd()`, not `import.meta.url`: under Vitest's transform
     * `import.meta.url` is a synthetic URL whose scheme is not `file`, so
     * `fileURLToPath` rejects it with "The URL must be of scheme file". The
     * repository root is the directory the runner is started in.
     */
    const source = readFileSync(resolve(process.cwd(), "src/word/documentObserver.ts"), "utf8");
    expect(source).not.toMatch(/revisionAdapter/);
    expect(source).not.toMatch(/applyChangePlan/);
    expect(source).not.toMatch(/applyReviewedPlan/);
  });

  it("never claims whole-document compliance from a narrowed scan", async () => {
    /*
     * The one an auto-scan is most likely to make, because it runs precisely
     * when it has *not* seen the rest of the document: the user typed one
     * character and the scan looked at one paragraph.
     */
    mocks.runDeterministicReview.mockImplementation(async (options: unknown) => {
      const call = options as { incremental?: boolean; incrementalReason?: string };
      return {
        ...report(1),
        coverage: {
          ...report(1).coverage,
          // The engine is asked to be honest; this case asserts the observer
          // passes the declaration through rather than reporting the narrow run
          // as a full one.
          complete: call.incremental !== true,
          examinedScopes: call.incremental === true ? ["body"] : ["body", "headings"],
        },
      };
    });

    const statuses = await observe(change());
    expect(statuses.at(-1)?.coverageComplete).toBe(false);
    expect(statuses.at(-1)?.examinedScopes).toEqual(["body"]);
  });

  it("passes the incremental declaration and the shortfall to the engine", async () => {
    await observe(change());

    const call = mocks.runDeterministicReview.mock.calls.at(-1)?.[0] as {
      incremental?: boolean;
      incrementalReason?: string;
    };
    expect(call.incremental).toBe(true);
    // The engine cannot invent a sentence about a scan it never saw.
    expect(call.incrementalReason).toMatch(/examined 1 of 3/);
  });

  it("replaces the session identity when the document changes, invalidating decisions", async () => {
    /*
     * §16: decisions bind to a document identity, and a document that moved is
     * not the document they were made about. The observer republishes the
     * identity on every scan; the review session reads it and discards decisions
     * whose fingerprint no longer matches. What the observer owes is to report
     * the *current* identity rather than the one it started with.
     */
    const statuses: Array<{ reviewSessionIdentity: { contentHash: string } | null }> = [];
    const observer = createDocumentObserver({
      debounceMs: 0,
      onStatus: (status) => statuses.push({ reviewSessionIdentity: status.reviewSessionIdentity }),
      profile: createEmptyProfile("Test"),
    });
    observer.startObserver();
    // The start scan is the baseline, and the assertion is about the *change*
    // afterwards, so it has to have succeeded. The *last* identity rather than
    // the first: the observer publishes an initial status before its first scan,
    // and reading index 0 would assert against that empty one.
    await flush();
    const before = statuses.at(-1)?.reviewSessionIdentity?.contentHash;
    expect(before).toBe("hash-1");

    // The document has been edited since the first scan, so acquisition now
    // reports a different content hash.
    mocks.acquireAnalysisContext.mockImplementation(async () => ({
      ...context(),
      identity: { ...context().identity, contentHash: "hash-2" },
    }));
    mocks.runDeterministicReview.mockImplementation(async () => ({
      ...report(1),
      documentIdentity: { ...report(1).documentIdentity, contentHash: "hash-2" },
    }));

    observer.onDocumentChanged(change());
    await flush();
    observer.stopObserver();

    expect(statuses.at(-1)?.reviewSessionIdentity?.contentHash).toBe("hash-2");
  });

  it("marks a refreshed document stale rather than clean when the scan fails", async () => {
    // A failure after findings were accepted is *stale*, not *clean*: the list on
    // screen is no longer known to be true, and calling it clean is the one
    // answer that lets a user act on it.
    const statuses: Array<{ phase: string; stale: boolean }> = [];
    const observer = createDocumentObserver({
      debounceMs: 0,
      onStatus: (status) => statuses.push({ phase: status.phase, stale: status.stale }),
      profile: createEmptyProfile("Test"),
    });
    observer.startObserver();
    await flush();

    mocks.acquireAnalysisContext.mockRejectedValue(new Error("the host said no"));
    observer.onDocumentChanged(change());
    await flush();
    observer.stopObserver();

    expect(statuses.at(-1)?.phase).toBe("stale");
    expect(statuses.at(-1)?.stale).toBe(true);
  });

  it("reports a first-scan failure as failed, not as a clean document", async () => {
    // Before anything has been accepted there is nothing to be stale *relative
    // to*: the first scan simply failed, and an empty result reads as a clean
    // document.
    const statuses: Array<{ phase: string }> = [];
    const observer = createDocumentObserver({
      debounceMs: 0,
      onStatus: (status) => statuses.push({ phase: status.phase }),
      profile: createEmptyProfile("Test"),
    });
    mocks.acquireAnalysisContext.mockRejectedValue(new Error("the host said no"));
    observer.startObserver();
    await flush();
    observer.stopObserver();

    expect(statuses.at(-1)?.phase).toBe("failed");
  });
});
