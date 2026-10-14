/**
 * Tracked-revision inspection — the read half of revision-aware editing.
 *
 * `Body.getTrackedChanges()` (WordApi 1.6) is the canonical way to read
 * existing tracked changes. It gives author, date, text, type, and range
 * for each one. This module wraps that read in a guarded transaction so one
 * bad range costs one row, not the whole read.
 *
 * Non-destructive: this module never calls accept, reject, acceptAll, or
 * rejectAll (ADR-0012). It reads only.
 */

import { runInWord } from "../shared/office/officeHelpers";
import { TrackedRevisionSchema, type TrackedRevision } from "../core/domain/TrackedRevision";

export interface TrackedRevisionRead {
  /** false when getTrackedChanges is absent on the host. */
  supported: boolean;
  /** The parsed revisions, in host order. */
  revisions: TrackedRevision[];
  /** A message when the read failed but the API is present. */
  error?: string;
}

/**
 * Normalise `TrackedChange.date` to an ISO 8601 string (or null).
 *
 * Word serves `date` as a JavaScript `Date` object, not a string, so the DTO
 * schema (`z.string().nullable()`) rejected every row and the reader returned an
 * empty list on a document full of tracked changes — a real Desktop Word read
 * (2026-10-13) logged `Expected string, received date`. Coerce a `Date` to ISO,
 * pass a string through, and turn anything else into null so a malformed value
 * costs that row's date, not the row.
 */
function normalizeRevisionDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return typeof value === "string" ? value : null;
}

/**
 * Read all tracked changes in the body.
 *
 * Returns `supported: false` when the host does not expose
 * `Body.getTrackedChanges()` (pre-WordApi 1.6). When the API is present
 * but a row's getRange() fails, that row is skipped with its offsets set
 * to null — the revision is still reported, just without body-relative
 * positions.
 *
 * Never calls accept/reject: this is a pure read.
 */
export async function readTrackedRevisions(): Promise<TrackedRevisionRead> {
  return await runInWord(async (context): Promise<TrackedRevisionRead> => {
    const body = context.document.body;
    if (typeof body.getTrackedChanges !== "function") {
      return { supported: false, revisions: [] };
    }

    const collection = body.getTrackedChanges();
    if (typeof collection.load !== "function") {
      return { supported: false, revisions: [] };
    }

    try {
      collection.load("items");
      await context.sync();
    } catch {
      return { supported: false, revisions: [] };
    }

    const items = Array.isArray(collection.items) ? collection.items : [];
    const revisions: TrackedRevision[] = [];

    let index = 0;
    for (const item of items) {
      if (!item || typeof item.load !== "function") {
        index++;
        continue;
      }

      try {
        item.load(["author", "date", "text", "type"]);
        await context.sync();
      } catch (loadError) {
        console.warn(
          "revision item load failed " +
            JSON.stringify({
              index,
              error: loadError instanceof Error ? loadError.message : String(loadError),
            }),
        );
        index++;
        continue;
      }
      let range: { start: number; end: number } | null = null;
      try {
        if (typeof item.getRange === "function") {
          const changeRange = item.getRange();
          if (changeRange && typeof changeRange.load === "function") {
            changeRange.load(["start", "end"]);
            await context.sync();
            if (typeof changeRange.start === "number" && typeof changeRange.end === "number") {
              range = { start: changeRange.start, end: changeRange.end };
            }
          }
        }
      } catch {
        // One bad range costs that row's offsets, not the read.
        range = null;
      }

      try {
        const parsed = TrackedRevisionSchema.parse({
          index,
          type: item.type ?? "None",
          author: item.author ?? "",
          date: normalizeRevisionDate(item.date),
          text: item.text ?? "",
          range,
        });
        revisions.push(parsed);
      } catch (parseError) {
        // Skip unparseable rows.
        console.warn(
          "revision item parse failed " +
            JSON.stringify({
              index,
              error: parseError instanceof Error ? parseError.message : String(parseError),
            }),
        );
      }
      index++;
    }

    return { supported: true, revisions };
  });
}
