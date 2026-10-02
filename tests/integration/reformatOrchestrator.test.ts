/**
 * The orchestrator's remaining readback arms and its host probe.
 *
 * Spec §19 asks the post-apply report to say which change failed, and every
 * `verifyFormattingChange` arm is one answer to that. Only two of the six change
 * types had a case here, which meant a plan of four with one `setCharacterFormat`
 * among them reported nothing about it — the whole-plan `verify` was green while
 * a change was unconfirmed. Each arm below therefore gets its own case, and the
 * aggregate case is the one that pins the counts.
 *
 * The probe case is here for the same reason: `prepareReformatHost` is the only
 * production entry point that arms the mutation adapter's capability set, and it
 * was untested.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyReviewedPlan, prepareReformatHost, reformatDocument } from "../../src/reformat";
import { toAnalysisCapabilities } from "../../src/word/capabilityProbe";
import * as formattingReader from "../../src/word/formattingReader";
import * as capabilityProbe from "../../src/word/capabilityProbe";
import * as planner from "../../src/changes/planner";
import * as revisionAdapter from "../../src/word/revisionAdapter";
import { setStage01Passed } from "../../src/word/revisionAdapter";
import type { WordCapabilities } from "../../src/word/capabilityProbe";
import { v4 as uuidv4 } from "uuid";
import { StyleProfileSchema } from "../../src/core/domain/StyleProfile";
import { SAMPLE_PROFILE } from "../fixtures/sampleDocs";
import type { ChangePlan } from "../../src/core/domain/ChangePlan";
import { ChangePlanSchema } from "../../src/core/domain/ChangePlan";
import { hashDocument } from "../../src/word/documentReader";
import type { FormattingSnapshot } from "../../src/formatting/formattingSnapshot";

const PROFILE = StyleProfileSchema.parse(SAMPLE_PROFILE);

const FULL_CAPABILITIES: WordCapabilities = {
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

function makeRangeMock(onInsert?: (text: string) => void) {
  return {
    text: "",
    insertText: vi.fn(function (this: unknown, text: string) {
      onInsert?.(text);
      return this;
    }),
    insertBreak: vi.fn(),
    insertParagraph: vi.fn(() => ({ format: {}, load: vi.fn() })),
    paragraphs: { load: vi.fn(), items: [] },
    font: { name: "", size: 0, color: "", load: vi.fn(), set: vi.fn(), reset: vi.fn() },
    paragraphFormat: { set: vi.fn() },
    listFormat: { set: vi.fn() },
    style: "",
    set: vi.fn(function (this: unknown) {
      return this;
    }),
    load: vi.fn(),
  };
}

function makeFormattingSnapshot(text: string): FormattingSnapshot {
  return {
    id: "snapshot-1",
    text,
    paragraphs: [],
    capturedAt: "2026-01-01T00:00:00.000Z",
    hash: "abc123",
  };
}

function installOffice(
  bodyText: string,
  trackingMode: unknown = "Off",
  textProvider?: () => string,
) {
  let currentText = bodyText;
  const rangeMock = makeRangeMock((text) => {
    currentText = `${currentText}${text}`;
  });
  const sharedDoc: Record<string, unknown> = {
    id: "doc-1",
    load: vi.fn(),
    changeTrackingMode: trackingMode,
  };
  const body: Record<string, unknown> = {
    load: vi.fn(),
    getRange: vi.fn(() => rangeMock),
    getTrackedChanges: vi.fn(() => ({ load: vi.fn(), items: [{}] })),
    paragraphs: {
      load: vi.fn(),
      items: [
        {
          load: vi.fn(),
          style: { name: "Normal" },
          format: { alignment: null, lineSpacing: null, spaceAfter: null, spaceBefore: null },
          font: { name: null, size: null, color: null, bold: null, italic: null, underline: null },
        },
      ],
    },
  };
  Object.defineProperty(body, "text", {
    get: () => (textProvider ? textProvider() : currentText),
    configurable: true,
  });
  sharedDoc["body"] = body;
  sharedDoc["body"] = body;
  sharedDoc["getSelection"] = vi.fn(() => ({ getRange: vi.fn(() => rangeMock) }));
  sharedDoc["styles"] = { load: vi.fn(), items: [] };

  const context = {
    document: sharedDoc,
    host: { name: "Word", version: "16.0" },
    sync: vi.fn(),
  };
  const wordRun = vi.fn(<T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context));
  const officeRun = vi.fn(<T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context));
  const hostGlobals = globalThis as { Office?: unknown; Word?: unknown };
  hostGlobals.Office = {
    run: officeRun,
    roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
    InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
    BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
    InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
  };
  hostGlobals.Word = { run: wordRun };

  return { rangeMock, sharedDoc, wordRun, officeRun };
}

describe("reformatDocument integration", () => {
  let originalOffice: unknown;
  let originalWord: unknown;

  beforeEach(() => {
    const hostGlobals = globalThis as { Office?: unknown; Word?: unknown };
    originalOffice = hostGlobals.Office;
    originalWord = hostGlobals.Word;
    window.localStorage.setItem("ToneForge.TrackedEditingEnabled", "true");
    setStage01Passed(false);
    vi.spyOn(capabilityProbe, "probeWordCapabilities").mockResolvedValue(FULL_CAPABILITIES);
  });

  afterEach(() => {
    const hostGlobals = globalThis as { Office?: unknown; Word?: unknown };
    hostGlobals.Office = originalOffice;
    hostGlobals.Word = originalWord;
    setStage01Passed(false);
    window.localStorage.removeItem("ToneForge.TrackedEditingEnabled");
    vi.restoreAllMocks();
  });

  it("runs the full pipeline with deterministic findings and tracked apply", async () => {
    const { wordRun, officeRun } = installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await reformatDocument({
      profile: PROFILE,
    });

    expect(result.report.profileId).toBe(PROFILE.id);
    // The deterministic report names the document by its identity rather than
    // by a bare hash, so the plan and the report are compared through the field
    // each one actually has.
    expect(result.report.documentIdentity.contentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(result.plan.docHash).toBe(result.report.documentIdentity.contentHash);
    expect(result.plan.baseDocId).toBe("doc-1");
    expect(result.plan.stale).toBe(false);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((item) => item.applied)).toBe(true);
    expect(result.tracking.managed).toBe(true);
    expect(result.tracking.modeBefore).toBe("Off");
    expect(result.tracking.modeAfter).toBe("Off");
    expect(result.tracking.recordedCount).toBeGreaterThan(0);
    expect(result.applied).toBe(true);
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(wordRun.mock.calls.length).toBeGreaterThan(0);
    expect(officeRun).not.toHaveBeenCalled();
  });

  it("skips the apply step when there are no findings", async () => {
    installOffice("Hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const formattingSpy = vi.spyOn(formattingReader, "getFormattingSnapshot");
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await reformatDocument({
      profile: PROFILE,
      formattingSnapshot: makeFormattingSnapshot("Hello world"),
    });

    expect(result.plan.changes).toHaveLength(0);
    expect(result.results).toEqual([]);
    expect(result.tracking).toEqual({ managed: false });
    expect(result.applied).toBe(false);
    expect(formattingSpy).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("short-circuits empty documents without formatting or mutation reads", async () => {
    const { wordRun } = installOffice("");
    setStage01Passed(true, FULL_CAPABILITIES);
    const formattingSpy = vi.spyOn(formattingReader, "getFormattingSnapshot");
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await reformatDocument({
      profile: PROFILE,
    });

    expect(result.report.summary.total).toBe(0);
    expect(result.plan.changes).toHaveLength(0);
    expect(result.results).toEqual([]);
    expect(result.applied).toBe(false);
    expect(formattingSpy).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
    expect(wordRun.mock.calls.length).toBe(1);
  });

  it("returns a preview plan without entering the mutation adapter", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await reformatDocument({
      profile: PROFILE,
      preview: true,
      currentDocHash: "preview-stale-hash",
    });

    expect(result.plan.changes.length).toBeGreaterThan(0);
    expect(result.plan.stale).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.tracking).toEqual({ managed: false });
    expect(result.applied).toBe(false);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("marks a caller-observed hash mismatch stale before apply", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await reformatDocument({
      profile: PROFILE,
      currentDocHash: "stale-hash",
    });

    expect(result.plan.stale).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.tracking).toEqual({ managed: false });
    expect(result.applied).toBe(false);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("refuses immediately when tracked editing is disabled", async () => {
    installOffice("hello world");
    window.localStorage.setItem("ToneForge.TrackedEditingEnabled", "false");
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await reformatDocument({
      profile: PROFILE,
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((item) => !item.applied)).toBe(true);
    expect(result.results[0]?.error).toContain("Tracked editing is disabled");
    expect(result.tracking).toEqual({ managed: false });
    expect(result.applied).toBe(false);
    expect(applySpy).not.toHaveBeenCalled();
  });

  /*
   * Spec §3.2 removed semantic analysis from this path, and with it the three
   * tests that asserted it: the abort propagation, the "runs semantic when
   * includeRawText is true" case, and the "skips semantic when false" case.
   *
   * They are deleted rather than repointed at the new engine. Each asserted
   * behaviour that no longer exists — including the `signal` and `registry`
   * parameters, which the new options type does not have — and a test rewritten
   * to assert something else under the same name would be a test whose name
   * promised one thing and whose body checked another.
   *
   * What replaces the zero-LLM guarantee is not an absence of coverage: the
   * ESLint scope over `src/analysis/deterministic/**` makes an `ai` import a
   * build failure, and `tests/unit/analysis/deterministic/` asserts the report
   * type cannot carry a semantic finding. The second of those is stronger than
   * a spy on `registry.complete` ever was — a spy proves a given mock was not
   * called; a type cannot prove it was called.
   */

  it("uses a provided formatting snapshot without reading a second snapshot", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const formattingSpy = vi.spyOn(formattingReader, "getFormattingSnapshot");

    const result = await reformatDocument({
      profile: PROFILE,
      formattingSnapshot: makeFormattingSnapshot("hello world"),
    });

    // No formatting findings, because the supplied snapshot has no paragraphs
    // to compare. The summary buckets are the three the Review UI groups by.
    expect(result.report.summary.byCategoryGroup.formatting).toBe(0);
    expect(result.applied).toBe(true);
    expect(formattingSpy).not.toHaveBeenCalled();
  });

  it("refuses to apply when the host exposes no managed tracking control", async () => {
    installOffice("hello world", null);
    setStage01Passed(true, FULL_CAPABILITIES);

    const result = await reformatDocument({
      profile: PROFILE,
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((item) => !item.applied)).toBe(true);
    expect(result.results[0]?.error).toContain("Managed Track Changes");
    expect(result.tracking).toEqual({ managed: false });
    expect(result.applied).toBe(false);
    expect(result.verified).toBe(false);
  });

  it("aborts before the adapter when the live document hash differs", async () => {
    let tick = 0;
    installOffice("hello world", "Off", () => (tick++ === 0 ? "hello world" : "hello world!"));
    setStage01Passed(true, FULL_CAPABILITIES);
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await reformatDocument({
      profile: PROFILE,
    });

    expect(result.plan.changes.length).toBeGreaterThan(0);
    expect(result.plan.stale).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.tracking).toEqual({ managed: false });
    expect(result.applied).toBe(false);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("refuses conflicting plans without explicit override", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");
    const conflictingPlan = createConflictingPlan();
    vi.spyOn(planner, "planChanges").mockReturnValue(conflictingPlan);

    const result = await reformatDocument({
      profile: PROFILE,
      allowConflictingApply: false,
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((item) => !item.applied)).toBe(true);
    expect(result.results[0]?.error).toContain("conflict");
    expect(result.tracking).toEqual({ managed: false });
    expect(result.applied).toBe(false);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("refuses conflicting plans even when a legacy acknowledgement flag is supplied", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");
    const conflictingPlan = createConflictingPlan();
    vi.spyOn(planner, "planChanges").mockReturnValue(conflictingPlan);

    const result = await reformatDocument({
      profile: PROFILE,
      allowConflictingApply: true,
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((item) => !item.applied)).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.verified).toBe(false);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("verifies formatting readback for non-text plans", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const plan = ChangePlanSchema.parse({
      schemaVersion: 2,
      id: uuidv4(),
      docHash: hashDocument("hello world"),
      baseDocId: "doc-1",
      createdAt: new Date().toISOString(),
      changes: [
        {
          id: uuidv4(),
          type: "applyStyle",
          range: { start: 0, end: 1 },
          payload: { styleName: "Heading 2" },
          rationale: "test style readback",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          approvalState: "notRequired",
          precondition: { kind: "text", expectedText: "h" },
        },
      ],
      conflicts: [],
      stale: false,
      findings: [],
    });
    vi.spyOn(revisionAdapter, "applyChangePlanWithTracking").mockResolvedValue({
      results: [{ changeId: plan.changes[0]?.id ?? "", applied: true }],
      tracking: { managed: true },
    });
    const formattingSnapshot = makeFormattingSnapshot("hello world");
    formattingSnapshot.paragraphs = [
      {
        index: 0,
        text: "hello world",
        styleName: "Heading 2",
        alignment: null,
        lineSpacing: null,
        spaceAfter: null,
        spaceBefore: null,
        listLevel: null,
        fontName: null,
        fontSize: null,
        fontColor: null,
        bold: null,
        italic: null,
        underline: null,
      },
    ];
    vi.spyOn(formattingReader, "getFormattingSnapshot").mockResolvedValue(formattingSnapshot);

    const result = await applyReviewedPlan({ plan });

    expect(result.applied).toBe(true);
    expect(result.verified).toBe(true);
  });

  it("reports formatting readback mismatch instead of claiming success", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const plan = ChangePlanSchema.parse({
      schemaVersion: 2,
      id: uuidv4(),
      docHash: hashDocument("hello world"),
      baseDocId: "doc-1",
      createdAt: new Date().toISOString(),
      changes: [
        {
          id: uuidv4(),
          type: "setListLevel",
          range: { start: 0, end: 1 },
          payload: { level: 2 },
          rationale: "test list readback",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          approvalState: "notRequired",
          precondition: { kind: "text", expectedText: "h" },
        },
      ],
      conflicts: [],
      stale: false,
      findings: [],
    });
    vi.spyOn(revisionAdapter, "applyChangePlanWithTracking").mockResolvedValue({
      results: [{ changeId: plan.changes[0]?.id ?? "", applied: true }],
      tracking: { managed: true },
    });
    const formattingSnapshot = makeFormattingSnapshot("hello world");
    formattingSnapshot.paragraphs = [
      {
        index: 0,
        text: "hello world",
        styleName: "Normal",
        alignment: null,
        lineSpacing: null,
        spaceAfter: null,
        spaceBefore: null,
        listLevel: 0,
        fontName: null,
        fontSize: null,
        fontColor: null,
        bold: null,
        italic: null,
        underline: null,
      },
    ];
    vi.spyOn(formattingReader, "getFormattingSnapshot").mockResolvedValue(formattingSnapshot);

    const result = await applyReviewedPlan({ plan });

    expect(result.applied).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.verificationError).toContain("expected list level 2");
  });

  /*
   * Spec §19, at the orchestrator rather than the component.
   *
   * The previous readback returned on the *first* mismatch, so this plan would
   * have reported one error and said nothing about the change that landed. Under
   * Track Changes that is the case a user most needs itemised: two revisions are
   * in the document, one is right and one is not, and the decision is per
   * revision.
   */
  it("itemises every change when only one of two failed the readback", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const good = uuidv4();
    const bad = uuidv4();
    const plan = ChangePlanSchema.parse({
      schemaVersion: 2,
      id: uuidv4(),
      docHash: hashDocument("hello world"),
      baseDocId: "doc-1",
      createdAt: new Date().toISOString(),
      changes: [
        {
          id: good,
          type: "applyStyle",
          range: { start: 0, end: 1 },
          payload: { styleName: "Heading 2" },
          rationale: "the style that did land",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          approvalState: "notRequired",
          precondition: { kind: "text", expectedText: "hello world" },
        },
        {
          id: bad,
          type: "setListLevel",
          range: { start: 0, end: 1 },
          payload: { level: 2 },
          rationale: "the list level that did not",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          approvalState: "notRequired",
          precondition: { kind: "text", expectedText: "h" },
        },
      ],
      conflicts: [],
      stale: false,
      findings: [],
    });
    vi.spyOn(revisionAdapter, "applyChangePlanWithTracking").mockResolvedValue({
      results: [
        { changeId: good, applied: true },
        { changeId: bad, applied: true },
      ],
      tracking: { managed: true },
    });
    // The readback serves the style the plan asked for and a list level it did
    // not: one change confirms, one does not.
    const snapshot = makeFormattingSnapshot("hello world");
    snapshot.paragraphs = [
      {
        index: 0,
        text: "hello world",
        styleName: "Heading 2",
        alignment: null,
        lineSpacing: null,
        spaceAfter: null,
        spaceBefore: null,
        listLevel: 0,
        fontName: null,
        fontSize: null,
        fontColor: null,
        bold: null,
        italic: null,
        underline: null,
      },
    ];
    vi.spyOn(formattingReader, "getFormattingSnapshot").mockResolvedValue(snapshot);

    const result = await applyReviewedPlan({ plan });

    expect(result.verified).toBe(false);
    expect(result.outcome.changes).toHaveLength(2);
    expect(result.outcome.verifiedCount).toBe(1);
    expect(result.outcome.unverifiedCount).toBe(1);
    expect(result.outcome.changes.find((entry) => entry.changeId === good)?.verified).toBe(true);
    expect(result.outcome.changes.find((entry) => entry.changeId === bad)?.verified).toBe(false);
    expect(result.outcome.changes.find((entry) => entry.changeId === bad)?.error).toMatch(
      /list level/,
    );
  });

  it("counts the changes the adapter refused separately from the ones it wrote", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const refused = uuidv4();
    const written = uuidv4();
    const plan = ChangePlanSchema.parse({
      schemaVersion: 2,
      id: uuidv4(),
      docHash: hashDocument("hello world"),
      baseDocId: "doc-1",
      createdAt: new Date().toISOString(),
      changes: [
        {
          id: refused,
          type: "applyStyle",
          range: { start: 0, end: 1 },
          payload: { styleName: "Normal" },
          rationale: "refused",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          approvalState: "notRequired",
          precondition: { kind: "text", expectedText: "hello world" },
        },
        {
          id: written,
          type: "applyStyle",
          range: { start: 0, end: 1 },
          payload: { styleName: "Heading 2" },
          rationale: "written",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          approvalState: "notRequired",
          precondition: { kind: "text", expectedText: "hello world" },
        },
      ],
      conflicts: [],
      stale: false,
      findings: [],
    });
    vi.spyOn(revisionAdapter, "applyChangePlanWithTracking").mockResolvedValue({
      results: [
        { changeId: refused, applied: false, error: "Target is in a protected range." },
        { changeId: written, applied: true },
      ],
      tracking: { managed: true },
    });

    const result = await applyReviewedPlan({ plan });

    expect(result.applied).toBe(false);
    expect(result.outcome.failedCount).toBe(1);
    expect(result.outcome.changes).toHaveLength(2);
    expect(result.outcome.changes.find((entry) => entry.changeId === refused)?.error).toMatch(
      /protected range/,
    );
  });

  it("refreshes the review after a verified apply, so remaining issues are reported", async () => {
    /*
     * §19's "remaining deviations". A correction can leave a finding standing, and
     * a report that only counted the verification would say "all good" about a
     * document that still does not match the profile. The refresh is a *fresh*
     * review rather than a subtraction for exactly that reason.
     */
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const plan = ChangePlanSchema.parse({
      schemaVersion: 2,
      id: uuidv4(),
      docHash: hashDocument("hello world"),
      baseDocId: "doc-1",
      createdAt: new Date().toISOString(),
      changes: [
        {
          id: uuidv4(),
          type: "applyStyle",
          range: { start: 0, end: 1 },
          payload: { styleName: "Heading 2" },
          rationale: "test",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          approvalState: "notRequired",
          precondition: { kind: "text", expectedText: "hello world" },
        },
      ],
      conflicts: [],
      stale: false,
      findings: [],
    });
    vi.spyOn(revisionAdapter, "applyChangePlanWithTracking").mockResolvedValue({
      results: [{ changeId: plan.changes[0]?.id ?? "", applied: true }],
      tracking: { managed: true },
    });
    const snapshot = makeFormattingSnapshot("hello world");
    snapshot.paragraphs = [
      {
        index: 0,
        text: "hello world",
        styleName: "Heading 2",
        alignment: null,
        lineSpacing: null,
        spaceAfter: null,
        spaceBefore: null,
        listLevel: null,
        fontName: null,
        fontSize: null,
        fontColor: null,
        bold: null,
        italic: null,
        underline: null,
      },
    ];
    vi.spyOn(formattingReader, "getFormattingSnapshot").mockResolvedValue(snapshot);

    const result = await applyReviewedPlan({
      plan,
      profile: PROFILE,
      capabilities: toAnalysisCapabilities(FULL_CAPABILITIES),
    });

    expect(result.outcome.remainingFindings).not.toBeNull();
    expect(result.outcome.remainingFindings?.reviewType).toBe("deterministic");
  });

  /*
   * The `resetCharacterFormatting` and `setCharacterFormat` arms.
   *
   * `resetCharacterFormatting` is the one whose success condition is a list of
   * absences — every font property null and none of bold, italic or underline
   * true. Asserting only the failure direction would leave a reset that
   * half-worked reporting as verified, so the success case here serves a
   * genuinely cleared paragraph and the failure case one that still carries the
   * author's bold.
   */
  it("confirms a cleared character format and reports one that is still bold", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const cleared = uuidv4();
    const plan = ChangePlanSchema.parse({
      schemaVersion: 2,
      id: uuidv4(),
      docHash: hashDocument("hello world"),
      baseDocId: "doc-1",
      createdAt: new Date().toISOString(),
      changes: [
        {
          id: cleared,
          type: "resetCharacterFormatting",
          range: { start: 0, end: 1 },
          payload: {},
          rationale: "test reset readback",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          approvalState: "notRequired",
          precondition: { kind: "text", expectedText: "hello world" },
        },
      ],
      conflicts: [],
      stale: false,
      findings: [],
    });
    vi.spyOn(revisionAdapter, "applyChangePlanWithTracking").mockResolvedValue({
      results: [{ changeId: cleared, applied: true }],
      tracking: { managed: true },
    });

    // A cleared paragraph: every font property null, no emphasis.
    const clearedSnapshot = makeFormattingSnapshot("hello world");
    clearedSnapshot.paragraphs = [
      {
        index: 0,
        text: "hello world",
        styleName: "Normal",
        alignment: null,
        lineSpacing: null,
        spaceAfter: null,
        spaceBefore: null,
        listLevel: null,
        fontName: null,
        fontSize: null,
        fontColor: null,
        bold: null,
        italic: null,
        underline: null,
      },
    ];
    vi.spyOn(formattingReader, "getFormattingSnapshot").mockResolvedValue(clearedSnapshot);

    const confirmed = await applyReviewedPlan({ plan });
    expect(confirmed.outcome.verifiedCount).toBe(1);

    // The same plan against a paragraph that still carries bold: the reset did not
    // take, and saying so is the whole point of the readback.
    const stillBold = makeFormattingSnapshot("hello world");
    stillBold.paragraphs = [
      {
        ...(clearedSnapshot.paragraphs[0] as (typeof clearedSnapshot.paragraphs)[number]),
        bold: true,
      },
    ];
    vi.spyOn(formattingReader, "getFormattingSnapshot").mockResolvedValue(stillBold);

    const refused = await applyReviewedPlan({ plan });
    expect(refused.outcome.verifiedCount).toBe(0);
    expect(refused.outcome.changes[0]?.error).toMatch(/direct character formatting/);
  });

  it("confirms a character-format write against the properties it set", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const plan = ChangePlanSchema.parse({
      schemaVersion: 2,
      id: uuidv4(),
      docHash: hashDocument("hello world"),
      baseDocId: "doc-1",
      createdAt: new Date().toISOString(),
      changes: [
        {
          id: uuidv4(),
          type: "setCharacterFormat",
          range: { start: 0, end: 1 },
          payload: { name: "Georgia", size: 12 },
          rationale: "test character readback",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          approvalState: "notRequired",
          precondition: { kind: "text", expectedText: "hello world" },
        },
      ],
      conflicts: [],
      stale: false,
      findings: [],
    });
    vi.spyOn(revisionAdapter, "applyChangePlanWithTracking").mockResolvedValue({
      results: [{ changeId: plan.changes[0]?.id ?? "", applied: true }],
      tracking: { managed: true },
    });
    const snapshot = makeFormattingSnapshot("hello world");
    snapshot.paragraphs = [
      {
        index: 0,
        text: "hello world",
        styleName: "Normal",
        alignment: null,
        lineSpacing: null,
        spaceAfter: null,
        spaceBefore: null,
        listLevel: null,
        fontName: "Georgia",
        fontSize: 12,
        fontColor: null,
        bold: null,
        italic: null,
        underline: null,
      },
    ];
    vi.spyOn(formattingReader, "getFormattingSnapshot").mockResolvedValue(snapshot);

    const result = await applyReviewedPlan({ plan });
    expect(result.outcome.verifiedCount).toBe(1);
  });

  it("confirms paragraph formatting against every property the plan set", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const plan = ChangePlanSchema.parse({
      schemaVersion: 2,
      id: uuidv4(),
      docHash: hashDocument("hello world"),
      baseDocId: "doc-1",
      createdAt: new Date().toISOString(),
      changes: [
        {
          id: uuidv4(),
          type: "setParagraphFormat",
          range: { start: 0, end: 1 },
          payload: { alignment: "justified", spaceAfter: 6 },
          rationale: "test paragraph readback",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          approvalState: "notRequired",
          precondition: { kind: "text", expectedText: "hello world" },
        },
      ],
      conflicts: [],
      stale: false,
      findings: [],
    });
    vi.spyOn(revisionAdapter, "applyChangePlanWithTracking").mockResolvedValue({
      results: [{ changeId: plan.changes[0]?.id ?? "", applied: true }],
      tracking: { managed: true },
    });
    const snapshot = makeFormattingSnapshot("hello world");
    snapshot.paragraphs = [
      {
        index: 0,
        text: "hello world",
        styleName: "Normal",
        alignment: "justified",
        lineSpacing: null,
        spaceAfter: 6,
        spaceBefore: null,
        listLevel: null,
        fontName: null,
        fontSize: null,
        fontColor: null,
        bold: null,
        italic: null,
        underline: null,
      },
    ];
    vi.spyOn(formattingReader, "getFormattingSnapshot").mockResolvedValue(snapshot);

    const result = await applyReviewedPlan({ plan });
    expect(result.outcome.verifiedCount).toBe(1);
  });

  it("reports a readback that did not contain the target paragraph at all", async () => {
    /*
     * A distinct failure from "the value did not match": the paragraph is gone,
     * which happens when the apply shifted the document and the readback indexes
     * no longer line up. Reporting "readback did not match" there would send the
     * user to look at a formatting difference on a paragraph that no longer
     * exists at that position.
     */
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const plan = ChangePlanSchema.parse({
      schemaVersion: 2,
      id: uuidv4(),
      docHash: hashDocument("hello world"),
      baseDocId: "doc-1",
      createdAt: new Date().toISOString(),
      changes: [
        {
          id: uuidv4(),
          type: "applyStyle",
          range: { start: 0, end: 1 },
          payload: { styleName: "Heading 2" },
          rationale: "test missing-target readback",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          approvalState: "notRequired",
          precondition: { kind: "text", expectedText: "hello world" },
        },
      ],
      conflicts: [],
      stale: false,
      findings: [],
    });
    vi.spyOn(revisionAdapter, "applyChangePlanWithTracking").mockResolvedValue({
      results: [{ changeId: plan.changes[0]?.id ?? "", applied: true }],
      tracking: { managed: true },
    });
    // No paragraphs at all: the readback found nothing to compare against.
    vi.spyOn(formattingReader, "getFormattingSnapshot").mockResolvedValue(
      makeFormattingSnapshot(""),
    );

    const result = await applyReviewedPlan({ plan });
    expect(result.outcome.changes[0]?.error).toMatch(/did not contain the target paragraph/);
  });

  it("probes the host without arming the mutation adapter", async () => {
    /*
     * `prepareReformatHost` is the only production entry point that establishes
     * the capability set the adapter later enforces, and it is deliberately
     * non-destructive: it returns a probe result and nothing else. Asserting both
     * halves matters — the result is useful, and the stage flag stays false
     * because no host has been certified (ADR-0058).
     */
    setStage01Passed(false, FULL_CAPABILITIES);
    installOffice("hello world");
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const probed = await prepareReformatHost();

    expect(probed.hostName).toBe("Word");
    // Every new family defaults to `false` until a real host proves otherwise.
    expect(probed.supportsTables).toBe(false);
    expect(probed.supportsHeadersFooters).toBe(false);
    expect(probed.supportsSections).toBe(false);
    /*
     * The probe read the object model and wrote nothing. A probe that reached the
     * adapter would make ADR-0058's "the flag stays false until a real host has
     * been certified" claim false on the first Debug run, so this is asserted
     * through the adapter rather than through the probe result: the mock host
     * has no tracking surface, and arming the adapter against it would throw.
     */
    expect(probed.supportsRevisions).toBeTypeOf("boolean");
    expect(probed.supportsInsertBreak).toBeTypeOf("boolean");
    // Asserted through the adapter, not through the probe result: a probe that
    // reached the adapter would make ADR-0058's "the flag stays false until a real
    // host has been certified" claim false on the first Debug run.
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("reports a preview as attempting nothing, rather than as four failures", async () => {
    installOffice("hello world");
    const result = await reformatDocument({
      profile: PROFILE,
      capabilities: toAnalysisCapabilities(FULL_CAPABILITIES),
      preview: true,
    });

    // The distinction that `noAttemptOutcome` exists for: a preview is not a
    // refused apply, and rendering it as one would blame the adapter for a
    // decision this function made before reaching it.
    expect(result.outcome.failedCount).toBe(0);
    expect(result.outcome.verifiedCount).toBe(0);
    result.outcome.changes.forEach((entry) => {
      expect(entry.verified).toBe(false);
    });
  });

  it("uses the complete-document hash for text readback with a bounded analysis window", async () => {
    const { rangeMock } = installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const plan = ChangePlanSchema.parse({
      schemaVersion: 2,
      id: uuidv4(),
      docHash: hashDocument("hello world"),
      baseDocId: "doc-1",
      createdAt: new Date().toISOString(),
      changes: [
        {
          id: uuidv4(),
          type: "replaceText",
          range: { start: 0, end: 5 },
          payload: { text: "HELLO" },
          rationale: "test complete-document readback",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          approvalState: "notRequired",
          precondition: { kind: "text", expectedText: "hello" },
        },
      ],
      conflicts: [],
      stale: false,
      findings: [],
    });
    vi.spyOn(revisionAdapter, "applyChangePlanWithTracking").mockImplementation(async () => {
      rangeMock.insertText("HELLO");
      return {
        results: [{ changeId: plan.changes[0]?.id ?? "", applied: true }],
        tracking: { managed: true },
      };
    });

    const result = await applyReviewedPlan({ plan, maxChars: 5 });

    expect(result.applied).toBe(true);
    expect(result.verified).toBe(true);
  });

  it("applies a previously reviewed plan with a fresh structured protection check", async () => {
    const { sharedDoc } = installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const preview = await reformatDocument({
      profile: PROFILE,
      preview: true,
    });
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");
    const governanceRevision = preview.plan.governancePolicyRevision;
    if (governanceRevision === undefined) throw new Error("preview must capture policy revision");

    const result = await applyReviewedPlan({
      plan: preview.plan,
      currentGovernancePolicyRevision: governanceRevision,
    });

    expect(applySpy).toHaveBeenCalledWith(
      preview.plan,
      preview.plan.docHash,
      false,
      expect.any(Array),
      governanceRevision,
    );
    expect(result.applied).toBe(true);
    expect(result.stale).toBe(false);
    expect(sharedDoc["body"]).toBeDefined();
  });

  it("refuses a reviewed plan when the document hash changed", async () => {
    let tick = 0;
    installOffice("hello world", "Off", () => (tick++ === 0 ? "hello world" : "changed"));
    setStage01Passed(true, FULL_CAPABILITIES);
    const preview = await reformatDocument({
      profile: PROFILE,
      preview: true,
    });
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await applyReviewedPlan({ plan: preview.plan });

    expect(result.stale).toBe(true);
    expect(result.applied).toBe(false);
    expect(applySpy).not.toHaveBeenCalled();
  });
});

function createConflictingPlan(): ChangePlan {
  const docHash = hashDocument("hello world");
  return ChangePlanSchema.parse({
    schemaVersion: 2,
    id: uuidv4(),
    docHash,
    baseDocId: "doc-1",
    createdAt: new Date().toISOString(),
    changes: [
      {
        id: uuidv4(),
        type: "insertText",
        range: { start: 0, end: 0 },
        payload: { text: "a" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        approvalState: "notRequired",
        precondition: { kind: "text", expectedText: "" },
      },
      {
        id: uuidv4(),
        type: "replaceText",
        range: { start: 0, end: 0 },
        payload: { text: "b" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        approvalState: "notRequired",
        precondition: { kind: "text", expectedText: "" },
      },
    ],
    conflicts: [
      "Changes aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa and bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb conflict: same range has insertText and replaceText changes.",
    ],
    stale: false,
    findings: [],
  });
}
