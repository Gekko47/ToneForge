/**
 * Pure OOXML markup builders for authoring tracked revisions under a chosen
 * author name.
 *
 * **Why this exists.** `Word.TrackedChange.author` is read-only — there is no
 * API to set the author of a revision produced by `insertText`. The only way to
 * author under a chosen name is `Range.insertOoxml()` with explicit `w:ins` /
 * `w:del` markup carrying `w:author`. This module produces that markup as pure
 * strings so the builder is testable without an Office host.
 *
 * **Insert inline run-level markup** for character-range targets; wrap in
 * `<w:p>` for paragraph-unit targets. `xml:space="preserve"` is always set so
 * Word does not collapse whitespace in the text.
 */

import type { Change } from "../core/domain/Change";

export interface RevisionMarkupContext {
  author: string;
  date: string;
  nextId: () => number;
}

const DBL_QUOTE = String.fromCharCode(34);
const SINGLE_QUOTE = String.fromCharCode(39);
const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const W_NS_ATTR =
  "xmlns:w=" +
  DBL_QUOTE +
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main" +
  DBL_QUOTE;
const PKG_NS_ATTR =
  "xmlns:pkg=" + DBL_QUOTE + "http://schemas.microsoft.com/office/2006/xmlPackage" + DBL_QUOTE;
const REL_NS_ATTR =
  "xmlns=" + DBL_QUOTE + "http://schemas.openxmlformats.org/package/2006/relationships" + DBL_QUOTE;

const XML_ENTITIES: Record<string, string> = {
  [AMP]: AMP + "amp;",
  [LT]: AMP + "lt;",
  [GT]: AMP + "gt;",
  [DBL_QUOTE]: AMP + "quot;",
  [SINGLE_QUOTE]: AMP + "apos;",
};

/** Escape the five XML special characters in text content. */
export function escapeXmlText(text: string): string {
  return text.replace(
    new RegExp("[" + AMP + LT + GT + DBL_QUOTE + SINGLE_QUOTE + "]", "g"),
    (char) => XML_ENTITIES[char] ?? char,
  );
}

/** OOXML w:date format: YYYY-MM-DDTHH:MM:SSZ (no fractional seconds). */
function normalizeDate(date: string): string {
  return date.replace(/\.\d{3}Z$/, "Z");
}

function runText(text: string): string {
  return (
    "<w:t xml:space=" + DBL_QUOTE + "preserve" + DBL_QUOTE + ">" + escapeXmlText(text) + "</w:t>"
  );
}

function insMarkup(id: number, ctx: RevisionMarkupContext, text: string): string {
  const attrs =
    "w:id=" +
    DBL_QUOTE +
    id +
    DBL_QUOTE +
    " w:author=" +
    DBL_QUOTE +
    escapeXmlText(ctx.author) +
    DBL_QUOTE +
    " w:date=" +
    DBL_QUOTE +
    escapeXmlText(normalizeDate(ctx.date)) +
    DBL_QUOTE;
  return "<w:ins " + attrs + "><w:r>" + runText(text) + "</w:r></w:ins>";
}

/**
 * Build the single `<w:p>` body paragraph carrying the tracked revision runs,
 * or `null` for formatting-only changes.
 *
 * `replaceText` emits **only** the `<w:ins>` of the new text. It is inserted
 * with `InsertLocation.replace`, which already removes the target range — and
 * with managed Track Changes on, Word records that removal as a tracked
 * deletion. Including a `<w:del>` of the same old text made the host render the
 * old text as *added* content (you cannot mark text deleted in the same edit
 * that inserts it), so the change visibly added both the old and the new text.
 */
function buildRevisionParagraph(change: Change, ctx: RevisionMarkupContext): string | null {
  switch (change.type) {
    case "insertText": {
      const text = String(change.payload.text ?? "");
      return "<w:p>" + insMarkup(ctx.nextId(), ctx, text) + "</w:p>";
    }
    case "replaceText": {
      const newText = String(change.payload.text ?? "");
      return "<w:p>" + insMarkup(ctx.nextId(), ctx, newText) + "</w:p>";
    }
    case "deleteRange": {
      // Route through Replace with empty inserted content so the target range
      // is replaced by nothing (a deletion). This creates the tracked deletion
      // via the replace mechanism, preserving the signed-in user as the author,
      // rather than emitting a second delMarkup which would double-track.
      return "<w:p>" + insMarkup(ctx.nextId(), ctx, "") + "</w:p>";
    }
    default:
      return null;
  }
}

/**
 * Wrap a `<w:p>` body fragment in a complete Flat OPC package.
 *
 * `Range.insertOoxml` on the real Word host rejects a bare `<w:p>` fragment
 * with `RichApi.Error: GeneralException` (2026-10-13 host diagnostics). Word
 * expects the same **Flat OPC** envelope it emits from
 * `getSelectedDataAsync`/`getOoxml`: a `<pkg:package>` whose `/word/document.xml`
 * part holds `<w:document><w:body>`. The `xmlns:w` declaration lives on
 * `<w:document>` and covers the whole subtree.
 */
export function wrapInFlatOpcPackage(bodyXml: string): string {
  return (
    "<pkg:package " +
    PKG_NS_ATTR +
    ">" +
    "<pkg:part pkg:name=" +
    DBL_QUOTE +
    "/_rels/.rels" +
    DBL_QUOTE +
    " pkg:contentType=" +
    DBL_QUOTE +
    "application/vnd.openxmlformats-package.relationships+xml" +
    DBL_QUOTE +
    " pkg:padding=" +
    DBL_QUOTE +
    "512" +
    DBL_QUOTE +
    ">" +
    "<pkg:xmlData>" +
    "<Relationships " +
    REL_NS_ATTR +
    ">" +
    "<Relationship Id=" +
    DBL_QUOTE +
    "rId1" +
    DBL_QUOTE +
    " Type=" +
    DBL_QUOTE +
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" +
    DBL_QUOTE +
    " Target=" +
    DBL_QUOTE +
    "word/document.xml" +
    DBL_QUOTE +
    "/>" +
    "</Relationships>" +
    "</pkg:xmlData>" +
    "</pkg:part>" +
    "<pkg:part pkg:name=" +
    DBL_QUOTE +
    "/word/document.xml" +
    DBL_QUOTE +
    " pkg:contentType=" +
    DBL_QUOTE +
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" +
    DBL_QUOTE +
    ">" +
    "<pkg:xmlData>" +
    "<w:document " +
    W_NS_ATTR +
    "><w:body>" +
    bodyXml +
    "</w:body></w:document>" +
    "</pkg:xmlData>" +
    "</pkg:part>" +
    "</pkg:package>"
  );
}

/**
 * Build the OOXML markup for a tracked revision of this change.
 *
 * Returns `null` for formatting-only changes — those stay on the native
 * formatting setters and are authored as the signed-in user (documented
 * limitation; see the plan's "Risks and honest limits").
 *
 * The output is a complete Flat OPC package (see `wrapInFlatOpcPackage`).
 */
export function buildTrackedRevisionOoxml(
  change: Change,
  ctx: RevisionMarkupContext,
): string | null {
  const paragraph = buildRevisionParagraph(change, ctx);
  if (paragraph === null) return null;
  return wrapInFlatOpcPackage(paragraph);
}
