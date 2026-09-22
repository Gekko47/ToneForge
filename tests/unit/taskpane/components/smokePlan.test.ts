import { describe, it, expect } from "vitest";

import {
  buildSelectionChangePlan,
  locateSelectionOffset,
  snapshotHashOrCompute,
} from "../../../../src/taskpane/components/smokePlan";
import { hashDocument } from "../../../../src/word/documentReader";
import { SAMPLE_PROFILE } from "../../../fixtures/sampleDocs";
import type { StyleProfile } from "../../../../src/core/domain/StyleProfile";

const PROFILE = SAMPLE_PROFILE as unknown as StyleProfile;

describe("locateSelectionOffset", () => {
  it("rejects an empty selection", () => {
    const result = locateSelectionOffset("hello world", "");
    expect("error" in result).toBe(true);
  });

  it("rejects selection text missing from the body", () => {
    const result = locateSelectionOffset("hello world", "goodbye");
    expect("error" in result).toBe(true);
  });

  it("rejects ambiguous repeated selection text", () => {
    const result = locateSelectionOffset("hi hi hi", "hi");
    expect("error" in result).toBe(true);
  });

  it("locates a unique selection", () => {
    const result = locateSelectionOffset("hello brave world", "brave");
    expect(result).toEqual({ offset: { start: 6 } });
  });
});

describe("buildSelectionChangePlan", () => {
  it("plans deterministic findings with body-relative ranges", () => {
    // Straight double quotes violate the sample profile's curly preference.
    const bodyText = 'Intro paragraph here. He said "hi" loudly.';
    const selectionText = 'He said "hi" loudly.';
    const result = buildSelectionChangePlan({
      bodyText,
      selectionText,
      profile: PROFILE,
      docHash: hashDocument(bodyText),
      baseDocId: "doc-1",
    });

    expect("plan" in result).toBe(true);
    if (!("plan" in result)) return;
    expect(result.plan.findings.length).toBeGreaterThan(0);
    const selectionStart = bodyText.indexOf(selectionText);
    for (const finding of result.plan.findings) {
      expect(finding.range.start).toBeGreaterThanOrEqual(selectionStart);
      expect(finding.range.end).toBeLessThanOrEqual(selectionStart + selectionText.length);
    }
    for (const change of result.plan.plan.changes) {
      expect(change.range.start).toBeGreaterThanOrEqual(selectionStart);
    }
    expect(result.plan.plan.docHash).toBe(hashDocument(bodyText));
  });

  it("returns an empty plan when the selection already matches", () => {
    const bodyText = "Clean text here.";
    const result = buildSelectionChangePlan({
      bodyText,
      selectionText: "Clean text here.",
      profile: PROFILE,
      docHash: hashDocument(bodyText),
      baseDocId: "doc-1",
    });

    expect("plan" in result).toBe(true);
    if (!("plan" in result)) return;
    expect(result.plan.findings).toHaveLength(0);
    expect(result.plan.plan.changes).toHaveLength(0);
  });

  it("returns an error for an unlocatable selection", () => {
    const result = buildSelectionChangePlan({
      bodyText: "hello world",
      selectionText: "",
      profile: PROFILE,
      docHash: "hash",
      baseDocId: "doc-1",
    });

    expect("error" in result).toBe(true);
  });
});

describe("snapshotHashOrCompute", () => {
  it("prefers the snapshot hash when present", () => {
    expect(snapshotHashOrCompute("text", "abc123")).toBe("abc123");
  });

  it("computes the hash when the snapshot carries none", () => {
    expect(snapshotHashOrCompute("text", undefined)).toBe(hashDocument("text"));
  });
});
