/**
 * The Office.js `load` contract, pinned.
 *
 * Every test here is one that would have **failed** before ADR-0100, or that
 * keeps the fix from being undone. The defect was a declaration widened to
 * accommodate a call, so nothing in the suite objected: the two mocks involved
 * were both more permissive than the host, and a mock that is more permissive
 * than the host cannot catch a call the host would not honour.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createLoadRecorder, createOfficeLoad } from "../../fixtures/officeLoad";
import { readSelectionScope } from "../../../src/word/selectionScope";
import { getLiveSelection } from "../../../src/word/documentReader";

describe("the Office.js load contract", () => {
  /*
   * Rebuilt per test, not once per `describe`. A shared recorder accumulates, so
   * the first assertion here would pass and the second would fail on a leftover
   * `"text"` \u2014 a test that fails for the wrong reason, which is the one kind of
   * failure that trains a reader to ignore a red line.
   */
  let log: { requests: string[] };
  let record: (property: string) => void;
  let load: (propertyNames: string | string[]) => unknown;
  // One object, not a fresh one per call: `load` returns its owner, and the
  // assertion is identity, so a factory would make the test pass or fail on
  // allocation rather than on behaviour.
  const owner = { owner: true };

  beforeEach(() => {
    const recorder = createLoadRecorder();
    log = recorder.log;
    record = recorder.record;
    load = createOfficeLoad(record, () => owner);
  });

  it("accepts one property name, which is the host's whole contract", () => {
    expect(load("text")).toBe(owner);
    expect(log.requests).toEqual(["text"]);
  });

  it("accepts an array of property names, and records each", () => {
    load(["text", "start", "end"]);

    expect(log.requests).toEqual(["text", "start", "end"]);
  });

  /**
   * The regression. The host does not throw here — it drops the extra arguments
   * and the failure surfaces later as "The property 'start' is not available",
   * which names a property rather than the mistake. Failing at the call turns a
   * confusing production error into a test failure that names the cause.
   */
  it("refuses more than one positional argument, because the host silently drops the rest", () => {
    const variadic = load as unknown as (...props: string[]) => unknown;

    expect(() => variadic("text", "start", "end")).toThrow(/takes one argument/i);
    // And the message has to say what to do, not only what is wrong.
    expect(() => variadic("text", "start", "end")).toThrow(/pass an array instead/i);
  });

  it("does not record anything for a call it refuses", () => {
    const variadic = load as unknown as (...props: string[]) => unknown;
    const before = log.requests.length;

    try {
      variadic("text", "start");
    } catch {
      // The throw is the assertion; this catch exists only so the check below runs.
    }

    // A half-applied request would let a test pass on properties the host never
    // loaded, which is the failure this whole file exists to prevent.
    expect(log.requests).toHaveLength(before);
  });

  it("rejects a non-string, non-array argument rather than coercing it", () => {
    const bad = load as unknown as (value: unknown) => unknown;

    expect(() => bad(42)).toThrow(/property name or an array/i);
  });
});

describe("the production call sites", () => {
  /**
   * Both of these load three properties in one round trip. Getting the form
   * wrong is invisible to every other test in the suite, because a permissive
   * mock makes it look right — so it is asserted here, against the load log,
   * rather than inferred from a passing read.
   */
  it("the selection scope loads text and both offsets in ONE argument list", async () => {
    const { log, record } = createLoadRecorder();
    /*
     * Annotated rather than inferred: `load` returns the object, so the
     * initializer refers to itself. Without the annotation that is a circular
     * inference, which TypeScript resolves to `any` — and a test double typed
     * `any` is a test double that has stopped checking anything.
     */
    interface SelectionDouble {
      text: string;
      start: number;
      end: number;
      load: (propertyNames: string | string[]) => unknown;
      paragraphs: unknown;
    }
    const selection: SelectionDouble = {
      text: "the second paragraph",
      start: 120,
      end: 143,
      load: createOfficeLoad(record, () => selection),
      paragraphs: {
        items: [],
        load: createOfficeLoad(
          () => undefined,
          () => undefined,
        ),
      },
    };

    (globalThis as { Office?: unknown }).Office = {
      run: async <T>(fn: (context: unknown) => Promise<T>): Promise<T> =>
        fn({ document: { getSelection: () => selection, id: "doc-1" }, sync: async () => {} }),
    };

    try {
      const result = await readSelectionScope();

      expect(result.status).toBe("ok");
      /*
       * The assertion that matters: an **array**, in one call, carrying all three
       * names. `["text"]` alone would be a different bug, and three positional
       * names is this one \u2014 the double above throws on those, so reaching the
       * assertion at all is the first half of the proof.
       *
       * The containing-paragraph load is asserted in `selectionScope.test.ts`,
       * which records the whole request list; this test is about the call's form.
       */
      expect(log.requests).toEqual(["text", "start", "end"]);
    } finally {
      (globalThis as { Office?: unknown }).Office = undefined;
    }
  });

  it("the live selection reader loads the same three properties the same way", async () => {
    const { log, record } = createLoadRecorder();
    interface SelectionDouble {
      text: string;
      start: number;
      end: number;
      load: (propertyNames: string | string[]) => unknown;
    }
    const selection: SelectionDouble = {
      text: "a sentence",
      start: 0,
      end: 11,
      load: createOfficeLoad(record, () => selection),
    };

    (globalThis as { Office?: unknown }).Office = {
      run: async <T>(fn: (context: unknown) => Promise<T>): Promise<T> =>
        fn({ document: { getSelection: () => selection }, sync: async () => {} }),
    };

    try {
      const result = await getLiveSelection();

      expect(result).toEqual({ text: "a sentence", start: 0, end: 11 });
      expect(log.requests).toEqual(["text", "start", "end"]);
    } finally {
      (globalThis as { Office?: unknown }).Office = undefined;
    }
  });
});
