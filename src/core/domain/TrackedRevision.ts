/**
 * Tracked-revision DTO and the author constant for revisions ToneForge authors.
 *
 * `Word.TrackedChange.author` is read-only — there is no API to set the author of
 * a revision produced by `insertText`. The only way to author under a chosen name
 * is `Range.insertOoxml()` with explicit `w:ins`/`w:del` markup carrying
 * `w:author`. This module holds both sides of that contract: the constant the
 * OOXML builder stamps, and the DTO the inspection reader returns.
 */

import { z } from "zod";
import { ChangeTargetSchema } from "./Change";

export const TONE_FORGE_REVISION_AUTHOR = "ToneForge";

/**
 * The `TrackedChange.type` values Word serves. `None` is included because a host
 * can serve a revision whose type is neither `Added`, `Deleted`, nor `Formatted`;
 * the enum must not throw on a value it was never told about.
 */
export const TrackedRevisionTypeSchema = z.enum(["Added", "Deleted", "Formatted", "None"]);
export type TrackedRevisionType = z.infer<typeof TrackedRevisionTypeSchema>;

/**
 * The offsets of a tracked revision in the raw body text.
 *
 * `null` when the host cannot serve them reliably — the inspection reader degrades
 * gracefully rather than guessing (see `word/revisionInspection.ts`).
 */
export const TrackedRevisionRangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export const TrackedRevisionSchema = z.object({
  /** Zero-based position in the host's tracked-change collection. */
  index: z.number().int().nonnegative(),
  type: TrackedRevisionTypeSchema,
  /** The `w:author` string the host served. Empty when the host withheld it. */
  author: z.string(),
  /** ISO 8601 when the host served a date, else null. */
  date: z.string().nullable(),
  /** The text the revision carries (inserted text, deleted text, or "" for formatting). */
  text: z.string(),
  /** Body-relative offsets, or null when the host cannot serve them. */
  range: TrackedRevisionRangeSchema.nullable(),
  /** The change target this revision corresponds to, when it can be determined. */
  target: ChangeTargetSchema.optional(),
});

export type TrackedRevision = z.infer<typeof TrackedRevisionSchema>;
