import { describe, expect, it } from "vitest";
import type { Change, ChangeSource } from "../../../src/core/domain/Change";
import { detectConflicts } from "../../../src/changes/conflictDetector";

const CHANGE_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHANGE_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHANGE_ID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CHANGE_ID_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function change(
  id: string,
  type: Change["type"],
  start: number,
  end: number,
  payload: Record<string, unknown> = {},
): Change {
  return {
    id,
    type,
    range: { start, end },
    payload,
    rationale: "test",
    reversible: true,
    source: "deterministic" as ChangeSource,
    risk: "none" as const,
    approvalRequired: false,
    dependsOn: [],
  };
}

describe("detectConflicts", () => {
  it("returns no conflicts for an empty or non-overlapping list", () => {
    expect(detectConflicts([])).toEqual([]);
    expect(
      detectConflicts([
        change(CHANGE_ID_A, "replaceText", 0, 2, { text: "a" }),
        change(CHANGE_ID_B, "replaceText", 2, 4, { text: "b" }),
      ]),
    ).toEqual([]);
  });

  it("reports an overlapping pair without dropping either change", () => {
    const changes = [
      change(CHANGE_ID_A, "replaceText", 0, 5, { text: "a" }),
      change(CHANGE_ID_B, "replaceText", 3, 8, { text: "b" }),
    ];

    expect(detectConflicts(changes)).toEqual([
      "Changes aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa and bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb conflict: overlapping ranges require review.",
    ]);
    expect(changes).toHaveLength(2);
  });

  it("identifies different change types on the same range", () => {
    const conflicts = detectConflicts([
      change(CHANGE_ID_A, "replaceText", 0, 4, { text: "a" }),
      change(CHANGE_ID_B, "deleteRange", 0, 4),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("same range has replaceText and deleteRange changes");
  });

  it("identifies style and direct-format contradictions", () => {
    const conflicts = detectConflicts([
      change(CHANGE_ID_A, "applyStyle", 0, 6, { styleName: "Normal" }),
      change(CHANGE_ID_B, "setCharacterFormat", 2, 8, { bold: true }),
    ]);

    expect(conflicts).toEqual([
      "Changes aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa and bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb conflict: style and direct-format changes contradict each other.",
    ]);
  });

  it("combines same-range and style/direct-format reasons", () => {
    const conflicts = detectConflicts([
      change(CHANGE_ID_A, "applyStyle", 0, 4, { styleName: "Normal" }),
      change(CHANGE_ID_B, "setParagraphFormat", 0, 4, { alignment: "center" }),
    ]);

    expect(conflicts[0]).toContain("same range has applyStyle and setParagraphFormat changes");
    expect(conflicts[0]).toContain("style and direct-format changes contradict each other");
  });

  it("treats identical insertion points as overlapping", () => {
    expect(
      detectConflicts([
        change(CHANGE_ID_A, "insertText", 4, 4, { text: "a" }),
        change(CHANGE_ID_B, "insertText", 4, 4, { text: "b" }),
      ]),
    ).toHaveLength(1);
  });

  it("does not treat distinct insertion points or boundary touches as overlaps", () => {
    expect(
      detectConflicts([
        change(CHANGE_ID_A, "insertText", 4, 4, { text: "a" }),
        change(CHANGE_ID_B, "insertText", 5, 5, { text: "b" }),
        change(CHANGE_ID_C, "insertText", 0, 0, { text: "c" }),
        change(CHANGE_ID_D, "replaceText", 0, 4, { text: "d" }),
      ]),
    ).toEqual([]);
  });

  it("reports multiple pairs in stable source order", () => {
    const conflicts = detectConflicts([
      change(CHANGE_ID_A, "replaceText", 0, 4, { text: "a" }),
      change(CHANGE_ID_B, "replaceText", 2, 5, { text: "b" }),
      change(CHANGE_ID_C, "replaceText", 2, 5, { text: "c" }),
    ]);

    expect(conflicts.map((message) => message.split(" and ")[0])).toEqual([
      "Changes aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "Changes aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "Changes bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
    expect(conflicts).toHaveLength(3);
  });
});
