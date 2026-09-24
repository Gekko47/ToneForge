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
import type { Finding } from "../core/domain/Finding";
import { resolveSourceRange } from "./documentReader";

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
 * Finding ranges are authoritative character offsets. A node identifier is
 * used to select the navigation strategy label only; it does not replace the
 * source range with a different document location. If the host cannot select
 * the requested range, the operation is a safe, logged no-op.
 */
export async function navigateToFinding(options: NavigateOptions): Promise<NavigateResult> {
  const { finding, highlight = true } = options;
  const { start, end, unit } = finding.range;

  try {
    const outcome = await runInWord(async (context) => {
      const body = context.document.body;
      body.load("text");
      await context.sync();

      const bodyLength = body.text.length;
      if (start > bodyLength || end > bodyLength || end < start) {
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
      range.set({ start, end });
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

      const resolved = resolveSourceRange(
        finding.nodeIds[0],
        unit === "paragraph" ? `body/paragraph/${start}` : undefined,
        start,
        end,
      );
      const method = resolved.nodeId ? ("nodeId" as const) : ("offsets" as const);

      return {
        navigated: true,
        method,
        message: `Selected finding ${finding.id} at characters ${start}–${end}.`,
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
