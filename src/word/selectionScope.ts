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
import { logger } from "../shared/utils/logger";
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

export interface SelectionScope {
  anchor: SemanticSelectionAnchor;
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
  load?: (...props: string[]) => unknown;
  paragraphs?: ParagraphCollectionView;
}

interface ParagraphCollectionView {
  load?: (prop: string) => unknown;
  items?: ParagraphView[];
}

interface ParagraphView {
  text?: string;
  uniqueLocalId?: string;
  load?: (props: string | string[]) => unknown;
}

interface CapturedSelection {
  text: string;
  start: number;
  end: number;
  documentId: string;
  nodeIds: string[];
  paragraphTexts: string[];
}

type CaptureOutcome =
  | { status: "ok"; captured: CapturedSelection }
  | { status: "no-selection" }
  | { status: "unavailable"; reason: string };

/**
 * Read the current selection and turn it into a semantic anchor.
 *
 * Returns `no-selection` for a collapsed or empty selection — including the
 * caret a user leaves behind by clicking in a paragraph — so the pane can say
 * what to do rather than sending an empty review to a provider.
 */
export async function readSelectionScope(): Promise<SelectionScopeResult> {
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

      // The offsets are loaded with the text in one load. Splitting them would
      // cost a second round trip to learn nothing extra, and a host that refuses
      // the pair is a host this module cannot build a safe anchor from anyway.
      try {
        range.load("text", "start", "end");
        await context.sync();
      } catch {
        logger.warn("Selection offsets are unreadable in this host", {
          verificationResult: "refused",
          refusalCategory: "selection_offsets_unavailable",
        });
        return { status: "unavailable", reason: NO_OFFSETS_REASON };
      }

      const text = typeof range.text === "string" ? range.text : "";
      const start = typeof range.start === "number" ? range.start : -1;
      const end = typeof range.end === "number" ? range.end : -1;
      if (start < 0 || end < start) {
        return { status: "no-selection" };
      }
      if (text.trim().length === 0 || end === start) {
        return { status: "no-selection" };
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
        },
      };
    });
  } catch {
    return { status: "unavailable", reason: NO_RUNTIME_REASON };
  }
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
