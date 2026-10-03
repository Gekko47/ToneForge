/**
 * Selection scope capture: what the user pointed at, read at the size of the
 * selection rather than the size of the document.
 *
 * **Why this module exists.** The semantic page used to call
 * `getStructuredSnapshot()` before every proposal — body text, the whole
 * paragraph collection, and a per-paragraph property load — purely to give
 * `resolveAnchor` some nodes to search. That is a whole-document read paid for
 * a selection-sized answer. This module returns the anchor the specification's
 * §18 asks for directly from the selection, so the read is proportional to what
 * the user highlighted.
 *
 * **No whole-document hash, deliberately.** Producing one requires reading the
 * whole document, which is the read this module exists to remove. The document's
 * identity is `documentId` — the host's own id where it exposes one — and the
 * target's identity is `selectionHash` over the selected text. Freshness before
 * Apply is not this module's job either: the revision adapter's exact `text`
 * precondition against the live document, plus the `structuralHash` the
 * reformat acquisition path already holds, already cover it without a new read
 * on the propose path.
 *
 * **Degradation is reported, never papered over.** A host that omits
 * `uniqueLocalId`, or that will not expose the selection's paragraph
 * collection, still produces a usable anchor — it simply has no paragraph
 * identity, and `verification` says so. A fabricated node id would satisfy the
 * type and fail at write time, which is strictly worse than an absent one. A
 * host that cannot give offsets cannot give a safe Apply, so that is reported as
 * `unavailable` with a reason rather than silently degraded to a guess.
 *
 * **Selection awareness is an open question, not a host limitation.** See
 * ADR-0094: the WordApi requirement sets carry no document-level selection
 * event, but the Office-level `documentSelectionChanged` event does exist via
 * `Office.context.document.addHandlerAsync`, and whether a given Word host
 * raises it is verified in a real host rather than assumed here. The explicit
 * read shipped below is the fallback either way, and a subscription would be
 * additive to it.
 */

import { runInWord } from "../shared/office/officeHelpers";
import { countWords, hashText } from "../shared/utils/text";
import { describeError, logger } from "../shared/utils/logger";
import {
  SemanticSelectionAnchorSchema,
  type SemanticSelectionAnchor,
} from "../core/domain/SemanticReviewSession";

/**
 * The document id used when the host exposes none.
 *
 * A placeholder, not an identity. It is recognisable on sight, it is the same
 * on every document, and — because `documentIdVerified` is `false` whenever it
 * appears — it can never be mistaken for a document the host actually named.
 */
export const UNIDENTIFIED_DOCUMENT = "unidentified-document";

/**
 * How far an anchor could be verified.
 *
 * `paragraph-identified` means the host named the containing paragraphs, so the
 * target can be re-found by identity. `offsets-and-text` means the anchor is
 * character offsets plus the captured text — still safe, because the revision
 * adapter compares that text against the live document before writing, but
 * without a structural handle. Troubleshooting reports the second as
 * *unverified*, never as *verified*.
 */
export type AnchorVerification = "paragraph-identified" | "offsets-and-text";

/**
 * Where the reviewed text came from, because the user did not choose it.
 *
 * `"selection"` is text the user dragged. `"caret-paragraph"` is the whole
 * paragraph the cursor happened to be in \u2014 they clicked once to place the caret
 * and ToneForge decided that was the unit. The pane must say which, because the
 * second is a judgement: a review of it costs a provider call on a paragraph the
 * user never highlighted.
 */
export type SelectionSource = "selection" | "caret-paragraph";

export interface SelectionScope {
  anchor: SemanticSelectionAnchor;
  /** Whether the user selected this text or the caret merely sat in it. */
  source: SelectionSource;
  /** False when `anchor.documentId` is the placeholder rather than a host id. */
  documentIdVerified: boolean;
  /** Containing paragraphs the host enumerated, whether or not it named them. */
  paragraphCount: number;
  /** True only when one paragraph's whole text is exactly the selection. */
  coversWholeParagraph: boolean;
  wordCount: number;
  verification: AnchorVerification;
}

/**
 * The outcome of a capture, as three distinguishable facts.
 *
 * A single `SelectionScope | null` would conflate "you have not selected
 * anything" with "this host cannot support a safe semantic review". Those need
 * different sentences in the pane and different remediation, and ADR-0069
 * requires every refusal to name the control that resolves it — so they are
 * separate arms here rather than one `null`.
 */
export type SelectionScopeResult =
  | { status: "ok"; scope: SelectionScope }
  | { status: "no-selection" }
  | { status: "unavailable"; reason: string };

/** Character offsets read from a selection proxy, guarded because they are optional. */
interface SelectionRangeView {
  text?: string;
  start?: number;
  end?: number;
  /*
   * One argument, as the host takes. This was variadic, which let the call below
   * compile; the host loads the first positional argument and ignores the rest,
   * so the read of `.start` that follows threw in a real Word (ADR-0100).
   */
  load?: (propertyNames: string | string[]) => unknown;
  paragraphs?: ParagraphCollectionView;
}

interface ParagraphCollectionView {
  load?: (propertyNames: string | string[]) => unknown;
  items?: ParagraphView[];
}

interface ParagraphView {
  text?: string;
  uniqueLocalId?: string;
  load?: (propertyNames: string | string[]) => unknown;
  /**
   * WordApi 1.1. `"Whole"` gives the paragraph's own range, with the offsets a
   * caret cannot supply \u2014 which is what makes a caret reviewable at all.
   */
  getRange?: (rangeLocation: string) => SelectionRangeView;
}

interface CapturedSelection {
  text: string;
  start: number;
  end: number;
  documentId: string;
  nodeIds: string[];
  paragraphTexts: string[];
  source: SelectionSource;
}

type CaptureOutcome =
  | { status: "ok"; captured: CapturedSelection }
  | { status: "no-selection" }
  | { status: "unavailable"; reason: string };

/**
 * Read the current selection and turn it into a semantic anchor.
 *
 * **A caret reviews its paragraph.** A collapsed or whitespace-only selection is
 * not treated as nothing: the containing paragraph is read whole and the scope says
 * `source: "caret-paragraph"` so the pane can tell the user what it decided. This
 * returned `no-selection` for a bare caret before, which is why clicking into a
 * paragraph and pressing the command reported "nothing is selected" while the same
 * click followed by a drag worked. The caret path was not implemented, and the
 * message it produced was accurate about the code and wrong about the host.
 *
 * A caret in an empty paragraph still returns `no-selection`: there is genuinely
 * nothing there, and padding it out would be a fabrication.
 */ export async function readSelectionScope(): Promise<SelectionScopeResult> {
  const outcome = await captureSelection();

  if (outcome.status === "no-selection") return { status: "no-selection" };
  if (outcome.status === "unavailable") return outcome;

  const { captured } = outcome;
  const anchor = SemanticSelectionAnchorSchema.safeParse({
    documentId: captured.documentId,
    nodeIds: captured.nodeIds,
    startOffset: captured.start,
    endOffset: captured.end,
    selectedText: captured.text,
    selectionHash: hashText(captured.text),
    capturedAt: new Date().toISOString(),
  });

  if (!anchor.success) {
    // Reached only if the host reports an offset or an id the schema rejects —
    // for example a negative start it claimed was a number. Refusing here keeps
    // the anchor honest rather than coercing it into shape.
    logger.warn("Captured selection did not satisfy the selection anchor contract", {
      issues: anchor.error.issues.map((issue) => issue.path.join(".")),
      verificationResult: "refused",
      refusalCategory: "selection_anchor_invalid",
    });
    return { status: "unavailable", reason: INVALID_ANCHOR_REASON };
  }

  return {
    status: "ok",
    scope: {
      anchor: anchor.data,
      source: captured.source,
      documentIdVerified: captured.documentId !== UNIDENTIFIED_DOCUMENT,
      paragraphCount: captured.paragraphTexts.length,
      coversWholeParagraph: coversWholeParagraph(captured.text, captured.paragraphTexts),
      wordCount: countWords(captured.text),
      verification: anchor.data.nodeIds.length > 0 ? "paragraph-identified" : "offsets-and-text",
    },
  };
}

/**
 * The one host transaction this module opens.
 *
 * A thrown transaction is reported as unavailable rather than propagated: this
 * is called from a button handler, and a rejection there is a console message
 * rather than something the user can act on.
 */
async function captureSelection(): Promise<CaptureOutcome> {
  try {
    return await runInWord(async (context): Promise<CaptureOutcome> => {
      const range = context.document.getSelection() as SelectionRangeView;
      if (!range || typeof range.load !== "function") {
        return { status: "unavailable", reason: NO_RANGE_REASON };
      }

      /*
       * The offsets are requested only where the host serves them.
       *
       * `Range.start` / `Range.end` are WordApiDesktop 1.4, the same requirement
       * set as `Range.set`. Asking for them on a host without it does not yield
       * absent numbers — the host refuses the transaction, which is what the
       * `catch` below has always been reporting as "no offsets here". So the
       * question is asked of the requirement set, and on a host without it only the
       * text is loaded: the paragraph ids and paragraph texts are still readable,
       * so the pane can say what it did read rather than describing a failure.
       *
       * Still one load. Splitting text from offsets would cost a second round trip
       * that could observe a different selection if the user moved between the two.
       */
      const servesOffsets =
        context.requirements?.isSetSupported?.("WordApiDesktop", "1.4") === true;
      try {
        // An **array**, not three arguments. `load` takes one; the host loads the
        // first positional argument and ignores the rest, so the variadic form
        // compiles here and throws on the next line in a real Word (ADR-0100).
        range.load(servesOffsets ? ["text", "start", "end"] : ["text"]);
        await context.sync();
      } catch {
        logger.warn("Selection offsets are unreadable in this host", {
          verificationResult: "refused",
          refusalCategory: "selection_offsets_unavailable",
          servesOffsets,
        });
        return { status: "unavailable", reason: NO_OFFSETS_REASON };
      }

      const text = typeof range.text === "string" ? range.text : "";
      const reportedStart = typeof range.start === "number" ? range.start : -1;
      const reportedEnd = typeof range.end === "number" ? range.end : -1;
      /*
       * **The host may report the pair in either order, and this host does.**
       *
       * A real Word reported a bare caret as `start: 1193, end: 1192` — the guard
       * below used to read `end < start` as "there is no range here" and return
       * `no-selection`, which sent the user the sentence "There is nothing to
       * review here" while the caret path that ADR-0103 added sat nine lines
       * further down, unreachable. The guard was written for the drag case,
       * predates the caret feature, and silently ate it: the caret review had
       * never run on any host, and no test could see it because every fixture
       * supplied an ordered pair.
       *
       * Order the offsets rather than refuse them. A pair is unusable only when
       * one of the two is missing, and the `min`/`max` is also what makes a
       * backwards drag \u2014 the user dragging right to left \u2014 produce an anchor the
       * revision adapter can hold, since its precondition compares `text` against
       * an ordered span.
       */
      /*
       * Unavailable, not "no selection".
       *
       * A missing or unusable pair says the host would not tell us *where* the
       * selection is; it says nothing about whether anything is selected. Reporting
       * `no-selection` here sent the user the sentence "There is nothing to review
       * here" for a paragraph that was there — and removed the one sentence that
       * names a host limitation and a remedy.
       */
      if (reportedStart < 0 || reportedEnd < 0) {
        logger.warn("Selection offsets are not a usable pair", {
          refusalCategory: "selection_offsets_incomplete",
          verificationResult: "refused",
          startOffset: reportedStart,
          endOffset: reportedEnd,
        });
        return { status: "unavailable", reason: NO_OFFSETS_REASON };
      }
      const start = Math.min(reportedStart, reportedEnd);
      const end = Math.max(reportedStart, reportedEnd);
      /*
       * A caret, or a drag that caught nothing but whitespace. Neither is text the
       * user chose, and neither carries offsets worth reviewing \u2014 so the unit is
       * the paragraph the cursor is in. Recorded as `caret-paragraph` rather than
       * `selection` so the pane can say what it decided on the user's behalf.
       *
       * **Empty text is the test, not an ordered pair.** This branch used to
       * require `end === start`, which is a second way of asking the same question
       * and a way the host can answer "no" to while the text is plainly empty.
       */
      if (text.trim().length === 0 || end === start) {
        const caret = await readCaretParagraph(context, range);
        if (caret === null) return { status: "no-selection" };
        return {
          status: "ok",
          captured: {
            text: caret.text,
            start: caret.start,
            end: caret.end,
            documentId: context.document.id ?? UNIDENTIFIED_DOCUMENT,
            nodeIds: caret.nodeIds,
            paragraphTexts: [caret.text],
            source: "caret-paragraph",
          },
        };
      }

      const containing = await readContainingParagraphs(context, range);
      return {
        status: "ok",
        captured: {
          text,
          start,
          end,
          documentId: context.document.id ?? UNIDENTIFIED_DOCUMENT,
          nodeIds: containing.nodeIds,
          paragraphTexts: containing.paragraphTexts,
          source: "selection",
        },
      };
    });
  } catch (error) {
    logger.warn("Selection capture threw in the host transaction", {
      refusalCategory: "selection_capture_threw",
      verificationResult: "refused",
      error: describeError(error),
    });
    return { status: "unavailable", reason: NO_RUNTIME_REASON };
  }
}

/**
 * Expand a collapsed selection to the whole paragraph the caret is in.
 *
 * A caret has offsets but no extent, so there is nothing to review until the
 * paragraph is asked for its own range. `Paragraph.getRange("Whole")` is WordApi
 * 1.1 and is the only reason a caret is reviewable at all.
 *
 * `null` means "no paragraph here to review", and the caller turns that into
 * `no-selection`. It is a normal answer, not an error: an empty paragraph, a
 * caret in a text box the paragraph collection does not cover, and a host without
 * `getRange` all land here, and all of them correctly have nothing to review.
 *
 * The first item is taken rather than the last. A collapsed caret belongs to
 * exactly one paragraph; if a host enumerates more, the paragraph the range was
 * taken from is the one carrying that range, not the last one it listed.
 */
async function readCaretParagraph(
  context: Office.Context,
  range: SelectionRangeView,
): Promise<{ text: string; start: number; end: number; nodeIds: string[] } | null> {
  const collection = range.paragraphs;
  if (!collection || typeof collection.load !== "function") {
    return refuseCaret("selection-paragraphs-unavailable", { hasCollection: !!collection });
  }
  try {
    collection.load("items");
    await context.sync();
  } catch (error) {
    return refuseCaret("paragraph-items-load-refused", { error: describeError(error) });
  }
  const items = Array.isArray(collection.items) ? collection.items : [];
  const paragraph = items[0];
  if (!paragraph) {
    return refuseCaret("selection-has-no-paragraph", { paragraphItemCount: items.length });
  }
  if (typeof paragraph.getRange !== "function") {
    return refuseCaret("paragraph-get-range-absent", {
      paragraphHasLoad: typeof paragraph.load === "function",
    });
  }

  try {
    /*
     * One load, one sync, for the paragraph range and its own id. Splitting them
     * would be a second transaction that could observe a *different* caret if the
     * user moved between the two reads — which would anchor the review to a
     * paragraph the user is no longer in.
     */
    const whole = paragraph.getRange("Whole");
    whole?.load?.(["text", "start", "end"]);
    paragraph.load?.(["uniqueLocalId"]);
    await context.sync();
    if (!whole) {
      return refuseCaret("paragraph-range-unavailable", {
        hasParagraphLoad: typeof paragraph.load === "function",
      });
    }

    const text = typeof whole.text === "string" ? whole.text : "";
    const start = typeof whole.start === "number" ? whole.start : -1;
    const end = typeof whole.end === "number" ? whole.end : -1;
    // An empty paragraph is a real paragraph with nothing in it, and its text is
    // the paragraph mark alone.
    if (start < 0 || end < start || text.trim().length === 0) {
      return refuseCaret("paragraph-range-not-usable", {
        startOffset: start,
        endOffset: end,
        textLength: text.length,
      });
    }

    const nodeId =
      typeof paragraph.uniqueLocalId === "string" ? paragraph.uniqueLocalId.trim() : "";
    return { text, start, end, nodeIds: nodeId.length > 0 ? [nodeId] : [] };
  } catch (error) {
    return refuseCaret("paragraph-range-load-refused", { error: describeError(error) });
  }
}

/**
 * A caret that could not be expanded, said out loud.
 *
 * Every refusal on this path was a bare `return null`, and `null` is
 * indistinguishable at the page from "the user has nothing selected" \u2014 the same
 * conflation `SelectionScopeResult` was split to remove, re-entered one layer
 * down. A host that hands us a paragraph with no `getRange` and a user who put a
 * caret in an empty paragraph produced the same sentence and the same silence.
 *
 * The category names the refusal. Nothing about the document is logged: this
 * module exists to keep document text local, and a diagnostic that quotes the
 * text it failed to expand would defeat it.
 */
function refuseCaret(refusalCategory: string, context: Record<string, unknown> = {}): null {
  logger.warn("Caret could not be expanded to its paragraph", {
    refusalCategory,
    verificationResult: "refused",
    ...context,
  });
  return null;
}

/**
 * Read the paragraphs the selection touches.
 *
 * Text and id are requested together and a refusal loses both, deliberately:
 * `uniqueLocalId` is WordApi 1.1 and present wherever the selection is, so the
 * combined load is the common case, and splitting it would mean a second
 * transaction that could observe a *different* selection if the user moved
 * between the two reads. Losing the ids costs the structural handle and nothing
 * else — `text`, `start` and `end` were resolved by the earlier sync and are
 * read straight off the proxies.
 */
async function readContainingParagraphs(
  context: Office.Context,
  range: SelectionRangeView,
): Promise<{ nodeIds: string[]; paragraphTexts: string[] }> {
  const collection = range.paragraphs;
  if (!collection || typeof collection.load !== "function") {
    return { nodeIds: [], paragraphTexts: [] };
  }
  try {
    collection.load("items");
    await context.sync();
  } catch {
    return { nodeIds: [], paragraphTexts: [] };
  }
  const items = Array.isArray(collection.items) ? collection.items : [];
  if (items.length === 0) {
    return { nodeIds: [], paragraphTexts: [] };
  }
  try {
    items.forEach((item) => item.load?.(["text", "uniqueLocalId"]));
    await context.sync();
  } catch {
    return { nodeIds: [], paragraphTexts: [] };
  }
  return {
    nodeIds: items
      .map((item) => (typeof item.uniqueLocalId === "string" ? item.uniqueLocalId.trim() : ""))
      .filter((id) => id.length > 0),
    paragraphTexts: items
      .map((item) => (typeof item.text === "string" ? item.text : ""))
      .filter((text) => text.trim().length > 0),
  };
}

/**
 * Whether the selection is exactly one paragraph, mark included or not.
 *
 * Word's paragraph `text` carries a trailing paragraph mark (`\r`, or `\u0007`
 * in a table cell) that a selection usually does not, so both sides are stripped
 * of their trailing marks before comparison. False when the host enumerated no
 * paragraphs — "not established" rather than "not the case", which is what
 * keeps the apply path on its offset fallback instead of claiming a structural
 * match it never made.
 */
export function coversWholeParagraph(
  selectedText: string,
  paragraphTexts: readonly string[],
): boolean {
  if (paragraphTexts.length !== 1) return false;
  return stripParagraphMark(selectedText) === stripParagraphMark(paragraphTexts[0] as string);
}

function stripParagraphMark(text: string): string {
  return text.replace(/[\r\n\u0007]+$/, "");
}

/**
 * Whether a re-read describes the same target as an existing anchor.
 *
 * The cheap staleness check the pane can make before it overwrites a paid-for
 * review: the text is the target, so equal text means the same target. It is
 * not a document-identity check — a document can change elsewhere without this
 * noticing — and it is not a substitute for the adapter's precondition, which
 * is what actually guards the write.
 */
export function anchorMatches(anchor: SemanticSelectionAnchor, currentText: string): boolean {
  return anchor.selectionHash === hashText(currentText);
}

const NO_RUNTIME_REASON =
  "Word is not reachable from the add-in, so the selection cannot be read. Reopen the task pane from the ribbon, or copy the text into Semantic Style and learn from it there.";
const NO_RANGE_REASON =
  "This Word build does not expose a document selection, so a selection cannot be reviewed. Update Word, or copy the text into Semantic Style and learn from it there.";
const NO_OFFSETS_REASON =
  "This Word build does not report where a selection starts and ends, so ToneForge cannot tell what text it would replace. Update Word, or copy the text into Semantic Style and learn from it there.";
const INVALID_ANCHOR_REASON =
  "The captured selection did not match the selection anchor contract, so nothing was sent and nothing will be written. Update Word, or copy the text into Semantic Style and learn from it there.";
