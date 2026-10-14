/**
 * Tests for the OOXML builder that produces tracked-revision markup.
 *
 * The builder must stamp `w:author` with the app's author string, escape XML
 * special characters, preserve whitespace with `xml:space="preserve"`, use
 * `w:delText` for deleted runs, and return null for formatting-only changes.
 */

import { describe, expect, it } from "vitest";
import { buildTrackedRevisionOoxml, escapeXmlText } from "../../../src/word/revisionOoxml";
import type { Change } from "../../../src/core/domain/Change";
import { TONE_FORGE_REVISION_AUTHOR } from "../../../src/core/domain/TrackedRevision";

function ctx() {
  let nextId = 1000;
  return {
    author: TONE_FORGE_REVISION_AUTHOR,
    date: "2026-10-13T10:00:00Z",
    nextId: () => nextId++,
  };
}

function change(overrides: Partial<Change> = {}): Change {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    type: "insertText",
    range: { start: 0, end: 5, unit: "character" },
    payload: { text: "hello" },
    precondition: { kind: "text", expectedText: "hello" },
    ...overrides,
  } as Change;
}

describe("escapeXmlText", () => {
  it("escapes the five XML special characters", () => {
    const DQ = String.fromCharCode(34);
    const AMP = String.fromCharCode(38);
    const LT = String.fromCharCode(60);
    const GT = String.fromCharCode(62);
    const SQ = String.fromCharCode(39);
    const input = AMP + LT + GT + DQ + SQ;
    const expected = AMP + "amp;" + AMP + "lt;" + AMP + "gt;" + AMP + "quot;" + AMP + "apos;";
    expect(escapeXmlText(input)).toBe(expected);
  });

  it("leaves normal text unchanged", () => {
    expect(escapeXmlText("Hello, World!")).toBe("Hello, World!");
  });

  it("escapes ampersand first so double-escaping does not occur", () => {
    expect(escapeXmlText("<")).toBe("&lt;");
  });
});

describe("buildTrackedRevisionOoxml", () => {
  const DQ = String.fromCharCode(34);

  it("stamps w:author with the app author string", () => {
    const xml = buildTrackedRevisionOoxml(change({ payload: { text: "corrected" } }), ctx());

    expect(xml).toContain("w:author=" + DQ + TONE_FORGE_REVISION_AUTHOR + DQ);
  });

  it("includes w:date from the context", () => {
    const xml = buildTrackedRevisionOoxml(change(), ctx());

    expect(xml).toContain("w:date=" + DQ + "2026-10-13T10:00:00Z" + DQ);
  });

  it("sets xml:space=preserve on the text element", () => {
    const xml = buildTrackedRevisionOoxml(change(), ctx());

    expect(xml).toContain("xml:space=" + DQ + "preserve" + DQ);
  });

  it("uses w:delText for deleted runs", () => {
    const xml = buildTrackedRevisionOoxml(
      change({
        type: "deleteRange",
        payload: {},
        precondition: { kind: "text", expectedText: "old" },
      }),
      ctx(),
    );

    expect(xml).toContain("w:delText");
    expect(xml).toContain("xml:space=" + DQ + "preserve" + DQ);
    expect(xml).not.toContain("<w:t>");
  });

  it("returns null for formatting-only changes", () => {
    const xml = buildTrackedRevisionOoxml(
      change({
        type: "setCharacterFormat",
        payload: { bold: true },
        precondition: { kind: "formatting", expected: {} },
      }),
      ctx(),
    );

    expect(xml).toBeNull();
  });

  it("returns null for applyStyle changes", () => {
    const xml = buildTrackedRevisionOoxml(
      change({
        type: "applyStyle",
        payload: { styleName: "Heading 1" },
        precondition: { kind: "node", nodeId: "p1", expectedStyleName: "Normal" },
      }),
      ctx(),
    );

    expect(xml).toBeNull();
  });

  it("produces w:ins markup for insertText", () => {
    const xml = buildTrackedRevisionOoxml(
      change({ type: "insertText", payload: { text: "new" } }),
      ctx(),
    );

    expect(xml).toContain("<w:ins");
    expect(xml).toContain(">new</w:t>");
    expect(xml).toContain("</w:ins>");
  });

  it("produces w:ins only for replaceText (Replace removes the original)", () => {
    const xml = buildTrackedRevisionOoxml(
      change({
        type: "replaceText",
        payload: { text: "new" },
        precondition: { kind: "text", expectedText: "old" },
      }),
      ctx(),
    );

    expect(xml).toContain("<w:ins");
    expect(xml).toContain(">new</w:t>");
    expect(xml).not.toContain("<w:del");
    expect(xml).not.toContain("old</w:delText>");
  });

  it("produces only w:del for deleteRange", () => {
    const xml = buildTrackedRevisionOoxml(
      change({
        type: "deleteRange",
        payload: {},
        precondition: { kind: "text", expectedText: "remove me" },
      }),
      ctx(),
    );

    expect(xml).toContain("<w:del");
    expect(xml).not.toContain("<w:ins");
    expect(xml).toContain(">remove me</w:delText>");
  });

  it("escapes XML special characters in text content", () => {
    const xml = buildTrackedRevisionOoxml(change({ payload: { text: "a & b < c" } }), ctx());

    const AMP = String.fromCharCode(38);
    const LT = String.fromCharCode(60);
    expect(xml).toContain("a " + AMP + "amp; b " + AMP + "lt; c");
    expect(xml).not.toContain("a " + AMP + " b " + LT + " c");
  });

  it("increments the id across multiple calls", () => {
    const context = ctx();
    const first = buildTrackedRevisionOoxml(change({ payload: { text: "first" } }), context);
    const second = buildTrackedRevisionOoxml(change({ payload: { text: "second" } }), context);

    expect(first).toContain("w:id=" + DQ + "1000" + DQ);
    expect(second).toContain("w:id=" + DQ + "1001" + DQ);
  });

  it("wraps output in a Flat OPC package with a w:body paragraph", () => {
    const xml = buildTrackedRevisionOoxml(
      change({
        type: "insertText",
        range: { start: 0, end: 1, unit: "paragraph" },
        payload: { text: "paragraph text" },
      }),
      ctx(),
    );

    expect(xml).toContain("<pkg:package ");
    expect(xml).toContain("/word/document.xml");
    expect(xml).toContain("<w:document ");
    expect(xml).toContain("<w:body>");
    expect(xml).toContain("<w:p>");
    expect(xml).toContain("</w:p>");
  });

  it("declares the wordprocessingml namespace on w:document", () => {
    const xml = buildTrackedRevisionOoxml(change(), ctx());

    expect(xml).toContain("xmlns:w=");
    expect(xml).toContain("wordprocessingml/2006/main");
  });

  it("wraps character-unit output in a w:p body paragraph too", () => {
    const xml = buildTrackedRevisionOoxml(
      change({ range: { start: 0, end: 5, unit: "character" } }),
      ctx(),
    );

    expect(xml).toContain("<w:body><w:p>");
    expect(xml).toContain("</w:p></w:body>");
  });
});
