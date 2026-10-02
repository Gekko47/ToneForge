/**
 * The semantic revision's write, end to end (plan P6, D11, D4).
 *
 * The unit tests pin the shape of the change and the two adapter checks in
 * isolation. This file is the only place where the whole chain runs: capture →
 * plan → `applyReviewedPlan` → `applyChangePlanWithTracking` → the sole mutation
 * path → readback. What it exists to prove is the shape of the *result*: one
 * change written, verified against a document that actually changed, refused —
 * with nothing written — whenever any of the four guards fires.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashText } from "../../src/shared/utils/text";
import { hashDocument } from "../../src/word/documentReader";
import type { WordCapabilities } from "../../src/word/capabilityProbe";
import type { SemanticSelectionAnchor } from "../../src/core/domain/SemanticReviewSession";
import type { ApprovedSemanticRevision } from "../../src/reformat/semanticApply";

const ORIGINAL = "The pour completed on 3 March 2026 and the cube was cured for 28 days.";
const REVISED = "The pour finished on 3 March 2026 and the cube cured for 28 days.";

const CAPABILITIES: WordCapabilities = {
  supportsInsertText: true,
  supportsReplaceText: true,
  supportsInsertParagraph: true,
  supportsInsertBreak: true,
  supportsStyles: true,
  supportsParagraphFormat: true,
  supportsCharacterFormat: true,
  supportsResetCharacterFormatting: true,
  supportsListLevel: true,
  supportsRevisions: true,
  supportsSelection: true,
  supportsRangedReplacement: true,
  supportsParagraphResolution: true,
  supportsHighlight: true,
  supportsContextMenuApi: true,
  supportsTables: false,
  supportsHeadersFooters: false,
  supportsSections: false,
  supportsRibbonUpdate: true,
  hostName: "Word",
  hostVersion: "16.0",
};

/** The mutable document the host double serves. */
let documentText = ORIGINAL;
/** Offsets the last `body.getRange("Whole")` was narrowed to. */
let appliedRange: { start: number; end: number } | null = null;
/** Whether the paragraph the snapshot reports is protected. */
let paragraphProtected = false;

vi.mock("../../src/word/capabilityProbe", async (importOriginal) => {
  // Only the probe is replaced; `setStage01Passed` still has to be the real one,
  // because the test uses it. Typed as a plain record rather than with an
  // `import()` annotation, which the lint rules forbid.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, probeWordCapabilities: vi.fn(async () => CAPABILITIES) };
});

vi.mock("../../src/word/documentReader", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const structured = () => {
    const nodeId = "word-paragraph-p-1";
    return {
      documentId: "doc-1",
      versionToken: `2026-10-01T09:00:00.000Z:${hashDocument(documentText)}`,
      contentHash: hashDocument(documentText),
      structuralHash: "structural",
      capturedAt: "2026-10-01T09:00:00.000Z",
      fullText: documentText,
      analysisText: documentText,
      analysisStart: 0,
      analysisEnd: documentText.length,
      analysisTruncated: false,
      acquisition: {
        paragraphsFromWordCollection: true,
        structuralCoverage: "partial" as const,
        unsupported: [],
      },
      nodes: [
        {
          nodeId,
          type: "paragraph" as const,
          text: documentText,
          sourcePath: "body/paragraph/0",
          sourceRange: {
            nodeId,
            paragraphIndex: 0,
            structuralPath: "body/paragraph/0",
            startOffset: 0,
            endOffset: documentText.length,
          },
          editable: !paragraphProtected,
          includedInGovernance: true,
          includedInAIReview: true,
        },
      ],
    };
  };
  return {
    ...actual,
    getStructuredSnapshot: vi.fn(async () => structured()),
    getDocumentSnapshot: vi.fn(async () => ({
      id: "doc-1",
      text: documentText,
      fullText: documentText,
      fullDocumentHash: hashDocument(documentText),
      hash: hashDocument(documentText),
      paragraphs: [documentText],
      sentences: [documentText],
      wordCount: documentText.split(/\s+/).length,
      capturedAt: "2026-10-01T09:00:00.000Z",
    })),
  };
});

/**
 * A range double that performs the replacement the adapter asked for.
 *
 * `whole` models `Paragraph.getRange("Whole")`: it replaces the paragraph's text
 * rather than the offsets `set` was last given, which is how the real API behaves
 * and why the paragraph path needs no `Range.set` at all.
 */
function makeRange(whole = false) {
  const range = {
    text: "",
    insertText: vi.fn((text: string) => {
      const start = whole ? 0 : (appliedRange?.start ?? 0);
      const end = whole ? documentText.length : (appliedRange?.end ?? 0);
      documentText = `${documentText.slice(0, start)}${text}${documentText.slice(end)}`;
      return range;
    }),
    insertBreak: vi.fn(),
    insertParagraph: vi.fn(() => ({ format: {}, load: vi.fn() })),
    paragraphs: { load: vi.fn(), items: [] },
    font: { name: "", size: 0, color: "", load: vi.fn(), set: vi.fn(), reset: vi.fn() },
    paragraphFormat: { set: vi.fn() },
    listFormat: { set: vi.fn() },
    style: "",
    set: vi.fn((properties: { start?: number; end?: number }) => {
      appliedRange = { start: properties.start ?? 0, end: properties.end ?? 0 };
      return range;
    }),
    load: vi.fn(),
  };
  return range;
}

function installOffice(): void {
  const paragraphRange = makeRange(true);
  const paragraph = {
    get text() {
      return documentText;
    },
    uniqueLocalId: "p-1",
    style: "Normal",
    styleBuiltIn: "Normal",
    isListItem: false,
    load: vi.fn(),
    getRange: vi.fn(() => paragraphRange),
  };
  const document: Record<string, unknown> = {
    id: "doc-1",
    load: vi.fn(),
    changeTrackingMode: "Off",
    body: {
      get text() {
        return documentText;
      },
      load: vi.fn(),
      getRange: vi.fn(() => makeRange()),
      getTrackedChanges: vi.fn(() => ({ load: vi.fn(), items: [] })),
      paragraphs: { load: vi.fn(), items: [paragraph] },
    },
    getSelection: vi.fn(() => makeRange()),
    styles: { name: "", load: vi.fn(), items: [] },
  };
  const context = {
    document,
    host: { name: "Word", version: "16.0" },
    sync: vi.fn(),
  };
  const globals = globalThis as { Office?: unknown; Word?: unknown };
  globals.Office = {
    run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context),
    roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
    InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
    BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
    InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
  };
  globals.Word = { run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context) };
}

function anchor(): SemanticSelectionAnchor {
  return {
    documentId: "doc-1",
    nodeIds: ["p-1"],
    startOffset: 0,
    endOffset: ORIGINAL.length,
    selectedText: ORIGINAL,
    selectionHash: hashText(ORIGINAL),
    capturedAt: "2026-10-01T09:00:00.000Z",
  };
}

function revision(overrides: Partial<ApprovedSemanticRevision> = {}): ApprovedSemanticRevision {
  return {
    original: ORIGINAL,
    revised: REVISED,
    anchor: anchor(),
    coversWholeParagraph: true,
    rationale: "The sentence carries more than one main clause.",
    actionable: true,
    ...overrides,
  };
}

describe("applying an approved semantic revision", () => {
  beforeEach(async () => {
    documentText = ORIGINAL;
    appliedRange = null;
    paragraphProtected = false;
    window.localStorage.setItem("ToneForge.TrackedEditingEnabled", "true");
    installOffice();
    const { setStage01Passed } = await import("../../src/word/revisionAdapter");
    setStage01Passed(false);
  });

  afterEach(() => {
    window.localStorage.removeItem("ToneForge.TrackedEditingEnabled");
    vi.restoreAllMocks();
  });

  it("writes one change, and the readback confirms the document moved", async () => {
    const { applyApprovedSemanticRevision } = await import("../../src/reformat/semanticApply");

    const result = await applyApprovedSemanticRevision({ revision: revision() });

    expect(result.refusal).toBeNull();
    expect(result.plan.changes).toHaveLength(1);
    expect(result.plan.findings).toHaveLength(0);
    expect(result.applied).toBe(true);
    expect(result.verified).toBe(true);
    // The document now holds the revision, and nothing else moved.
    expect(documentText).toBe(REVISED);
    expect(result.outcome.verifiedCount).toBe(1);
  });

  it("refuses when the paragraph is protected, with no Finding in the plan", async () => {
    paragraphProtected = true;
    const { applyApprovedSemanticRevision } = await import("../../src/reformat/semanticApply");

    const result = await applyApprovedSemanticRevision({ revision: revision() });

    expect(result.plan.findings).toHaveLength(0);
    expect(result.applied).toBe(false);
    expect(result.results[0]?.error).toMatch(/protected range/i);
    // Nothing was written: the refusal is the point, not the reporting.
    expect(documentText).toBe(ORIGINAL);
  });

  it("refuses when the document moved between capture and apply", async () => {
    const { probeWordCapabilities } = await import("../../src/word/capabilityProbe");
    const trackedEditing = await import("../../src/reformat/trackedEditing");
    const spy = vi.spyOn(trackedEditing, "prepareTrackedEditing");
    spy.mockImplementation(async () => {
      // The user typed while the plan was being prepared.
      documentText = `${ORIGINAL} A further note was added.`;
      return { changes: 1, managed: true, hostName: "Word" } as never;
    });
    const { applyApprovedSemanticRevision } = await import("../../src/reformat/semanticApply");

    const result = await applyApprovedSemanticRevision({ revision: revision() });

    expect(probeWordCapabilities).toBeDefined();
    expect(result.applied).toBe(false);
    expect(result.stale).toBe(true);
    expect(result.results[0]?.error).toMatch(/stale|changed/i);
    expect(documentText).not.toBe(REVISED);
  });

  it("refuses when the text at the target is not what the user approved", async () => {
    // The precondition is what guards this: the document hash matched, but the
    // span no longer holds the text the user read.
    const { applyApprovedSemanticRevision } = await import("../../src/reformat/semanticApply");

    const result = await applyApprovedSemanticRevision({
      revision: revision({ original: "A sentence the document never contained." }),
    });

    expect(result.applied).toBe(false);
    expect(documentText).toBe(ORIGINAL);
  });
});
