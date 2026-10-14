/**
 * Source locator v1 — navigates the Word view to a finding without changing
 * document content. Uses the Word range object returned by Body.getRange(),
 * then Range.select() to move the selection. Temporary Range.highlight() is
 * used only when WordApi 1.8 is available.
 *
 * Boundary rule: word/ may import from shared/office, core/domain, and
 * shared/utils. It must never import ai or ui, and it must not mutate text.
 */

import { runInWord } from "../shared/office/officeHelpers";
import { logger } from "../shared/utils/logger";
import { nearestOccurrence } from "../shared/utils/text";
import type { Finding } from "../core/domain/Finding";
import { readBodyTextViews, resolveSourceRange } from "./documentReader";

export interface NavigateOptions {
  finding: Finding;
  highlight?: boolean;
}

export interface NavigateResult {
  navigated: boolean;
  method: "nodeId" | "offsets" | "unsupported";
  message: string;
}

interface NavigableRange extends Office.Range {
  select?: () => void;
  highlight?: () => void;
}

/**
 * Navigate the Word view to the location of a finding.
 *
 * Finding ranges are authoritative character offsets. Node identifiers are
 * carried as review metadata but do not change the navigation strategy until
 * the Word adapter can resolve a node directly. If the host cannot select the
 * requested range, the operation is a safe, logged no-op.
 */
export async function navigateToFinding(options: NavigateOptions): Promise<NavigateResult> {
  const { finding, highlight = true } = options;
  const { start, end, unit } = finding.range;

  try {
    const outcome = await runInWord(async (context) => {
      /*
       * Character offsets are the only unit `Range.set` counts. A paragraph,
       * section, table, header, or footer finding counts in its own unit — its
       * `start` is an index, not a character position — so feeding it to `set`
       * selected an unrelated span. That is the "incorrect placement": a
       * paragraph finding at index 2 highlighted characters 2–3. Structural
       * findings resolve to their element's whole range instead.
       */
      if (unit !== "character") {
        const structural = (await resolveStructuralRange(
          context,
          finding,
        )) as NavigableRange | null;
        if (structural === null) {
          return {
            navigated: false,
            method: "unsupported" as const,
            message: `This Word host cannot locate the ${unit} this finding is about.`,
          };
        }
        if (typeof structural.select !== "function") {
          return {
            navigated: false,
            method: "unsupported" as const,
            message: `This Word host cannot select a finding range.`,
          };
        }

        structural.select();
        if (highlight && typeof structural.highlight === "function") {
          structural.highlight();
        }
        await context.sync();

        const structuralPath =
          finding.target !== undefined && finding.target.kind !== "text"
            ? finding.target.structuralPath
            : undefined;
        const resolved = resolveSourceRange(
          finding.nodeIds[0],
          structuralPath,
          undefined,
          undefined,
        );

        return {
          navigated: true,
          method: "nodeId" as const,
          message: resolved.nodeId
            ? `Selected finding ${finding.id} on ${unit} for node ${resolved.nodeId}.`
            : `Selected finding ${finding.id} on ${unit}.`,
        };
      }

      const body = context.document.body;
      /*
       * The finding's offsets are reviewed-view offsets: detection reads the
       * accept-all text (`getReviewedText("Current")`), which omits text a tracked
       * revision marked for deletion. `Range.set` counts the raw view, which keeps
       * it, so a tracked deletion before the finding shifts the raw position by
       * its length — setting the reviewed offset directly highlighted the wrong
       * span, off by exactly that much (ADR-0144). The finding's own text is
       * relocated into the raw view exactly as the apply path relocates a change.
       */
      const views = await readBodyTextViews(context);

      if (end > views.fullText.length || end < start) {
        return {
          navigated: false,
          method: "unsupported" as const,
          message: `Finding ${finding.id} is outside the current document text.`,
        };
      }

      const range = body.getRange("Whole") as NavigableRange;
      if (typeof range.set !== "function") {
        return {
          navigated: false,
          method: "unsupported" as const,
          message: "This Word host cannot narrow a body range to character offsets.",
        };
      }

      const expected = views.fullText.slice(start, end);
      const located =
        expected.length === 0 ? start : nearestOccurrence(views.rawText, expected, start);
      const targetStart = located === -1 ? start : located;
      const targetEnd = located === -1 ? end : located + expected.length;

      range.set({ start: targetStart, end: targetEnd });
      if (typeof range.select !== "function") {
        return {
          navigated: false,
          method: "unsupported" as const,
          message: `This Word host cannot select a finding range.`,
        };
      }

      range.select();
      if (highlight && typeof range.highlight === "function") {
        range.highlight();
      }
      await context.sync();

      const resolved = resolveSourceRange(finding.nodeIds[0], undefined, targetStart, targetEnd);

      return {
        navigated: true,
        method: "offsets" as const,
        message: resolved.nodeId
          ? `Selected finding ${finding.id} at characters ${targetStart}–${targetEnd} for node ${resolved.nodeId}.`
          : `Selected finding ${finding.id} at characters ${targetStart}–${targetEnd}.`,
      };
    });

    return outcome;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Finding navigation failed", { findingId: finding.id, error: message });
    return {
      navigated: false,
      method: "unsupported",
      message: `Finding ${finding.id} could not be selected: ${message}`,
    };
  }
}

/**
 * Resolve a structural finding to the whole range of the element it names.
 *
 * `finding.target` is authoritative when present — a table, header, footer, or
 * section finding carries one. A paragraph, section, or table finding that
 * predates `target` is still resolvable, because for those units `range.start`
 * *is* the element index and `unit` says which collection to read it from.
 *
 * Loads and syncs each collection before indexing its items, so the proxy
 * objects are populated by the host before access.
 *
 * Returns null when the host does not expose the collection, the index is out of
 * range, or the element cannot produce a Range — so navigation degrades to a
 * stated refusal rather than a wrong highlight.
 */
async function resolveStructuralRange(
  context: Office.Context,
  finding: Finding,
): Promise<Office.Range | null> {
  const { unit, start } = finding.range;
  const target = finding.target;
  const body = context.document.body;
  const sectionAt = async (index: number): Promise<Office.Section | undefined> => {
    const sections = context.document.sections;
    sections?.load("items");
    await context.sync();
    return sections?.items[index];
  };

  switch (unit) {
    case "paragraph": {
      const paragraphs = body.paragraphs;
      paragraphs?.load("items");
      await context.sync();
      const index = target?.kind === "paragraph" ? target.index : start;
      const paragraph = paragraphs?.items[index];
      return paragraph?.getRange ? paragraph.getRange("Whole") : null;
    }
    case "table": {
      const tables = body.tables;
      tables?.load("items");
      await context.sync();
      const index = target?.kind === "table" ? target.index : start;
      const table = tables?.items[index];
      return table?.getRange ? table.getRange("Whole") : null;
    }
    case "section": {
      const index = target?.kind === "section" ? target.index : start;
      const section = await sectionAt(index);
      return section ? section.body.getRange("Whole") : null;
    }
    case "header":
    case "footer": {
      let sectionIndex = start;
      if (target !== undefined && (target.kind === "header" || target.kind === "footer")) {
        sectionIndex = target.sectionIndex;
      }
      const section = await sectionAt(sectionIndex);
      if (section === undefined) return null;
      // The slot type (Primary/FirstPage/EvenPages) is not carried on the finding;
      // the primary slot is the one a header/footer finding is about in practice.
      const slot = unit === "header" ? section.getHeader("Primary") : section.getFooter("Primary");
      if (!slot || typeof slot.getRange !== "function") return null;
      return slot.getRange("Whole");
    }
    default:
      return null;
  }
}
