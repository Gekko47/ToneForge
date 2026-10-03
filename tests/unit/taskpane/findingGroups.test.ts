/**
 * Joining the run's occurrence groups to the findings the pane is showing.
 *
 * The defect these reproduce: the engine has always computed `report.groups` with
 * a batch-safety verdict, and nothing rendered it — so the whole batch-approval
 * module was unreachable (ND-7) and `groups` was discarded by the observer (ND-9).
 * Adding the rendering is easy; getting the *join* right is where the correctness
 * lives, because the list and the groups come from different sources in the shape
 * the code used to have.
 */

import { describe, expect, it } from "vitest";
import {
  describeGroup,
  resolveFindingGroups,
  undecidedIn,
} from "../../../src/taskpane/findingGroups";
import { reviewIdentity } from "../../../src/taskpane/occurrenceIdentity";
import type { DeterministicFindingGroup } from "../../../src/analysis/deterministic/contracts";
import { FindingSchema, type Finding } from "../../../src/core/domain/Finding";

/**
 * The uuid each readable label stands for.
 *
 * `Finding.id` and `DeterministicFindingGroup.occurrenceIds` are both uuids, so a
 * readable id like `"a"` fails the schema before the behaviour under test is ever
 * reached. Tabulated rather than derived: a hand-rolled uuid format is exactly the
 * kind of thing that comes out one character short of 36 and fails in a way that
 * looks like the code under test is broken.
 *
 * `padStart` on both segments, not string concatenation — the first version built
 * the leading segment as `` `0000000${index}` ``, which is 8 characters only while
 * `index` has one digit. The tenth label produced a 9-character segment, the uuid
 * came out 33 characters long, and Zod rejected it with an error pointing at
 * nothing in this file.
 */
const UUID_BY_LABEL: ReadonlyMap<string, string> = new Map(
  [
    "a",
    "b",
    "c1",
    "current",
    "e",
    "f",
    "from-another-run",
    "g1",
    "gone",
    "kept",
    "l",
    "l1",
    "m",
    "also-another",
    "s",
    "x1",
  ].map((label, index) => [
    label,
    [
      String(index + 1).padStart(8, "0"),
      "0000",
      "4000",
      "8000",
      String(index + 1).padStart(12, "0"),
    ].join("-"),
  ]),
);

function idOf(label: string): string {
  const uuid = UUID_BY_LABEL.get(label);
  if (uuid === undefined) throw new Error(`no uuid reserved for label "${label}"`);
  return uuid;
}

function finding(overrides: Partial<Finding> & { id: string }): Finding {
  return FindingSchema.parse({
    kind: "deterministic",
    category: "typography.emDash",
    ruleId: "typography/emDash",
    message: "a straight double hyphen is used where the profile calls for an em dash",
    severity: "warning",
    range: { start: 10, end: 12, unit: "character" },
    source: "deterministic",
    nodeIds: [],
    actionable: true,
    ...overrides,
    id: idOf(overrides.id),
  });
}

/** The uuid each label stands for, for a group's `occurrenceIds`. */
const ids = (...labels: string[]): string[] => labels.map(idOf);

function group(overrides: Partial<DeterministicFindingGroup> = {}): DeterministicFindingGroup {
  return {
    id: "typography.emDash",
    category: "typography.emDash",
    ruleId: "typography/emDash",
    expected: "—",
    occurrenceIds: [],
    safeBatchApproval: true,
    ...overrides,
  };
}

describe("resolveFindingGroups", () => {
  it("returns no units for no findings", () => {
    expect(resolveFindingGroups([], [])).toEqual({ units: [], staleGroups: [] });
  });

  it("renders a group of one as a plain occurrence, so a lone card carries no header", () => {
    const only = finding({ id: "a" });
    const { units } = resolveFindingGroups([group({ occurrenceIds: ids("a") })], [only]);

    expect(units).toEqual([{ kind: "single", finding: only }]);
  });

  it("renders a group of several as one unit carrying every occurrence", () => {
    const first = finding({ id: "a", range: { start: 1, end: 3, unit: "character" } });
    const second = finding({ id: "b", range: { start: 40, end: 42, unit: "character" } });
    const { units } = resolveFindingGroups(
      [group({ occurrenceIds: ids("a", "b") })],
      [first, second],
    );

    expect(units).toHaveLength(1);
    expect(units[0]?.kind).toBe("group");
    if (units[0]?.kind === "group") {
      expect(units[0].findings.map((entry) => entry.id)).toEqual(ids("a", "b"));
      expect(units[0].missing).toBe(0);
    }
  });

  /*
   * The defect this replaces, stated as a test.
   *
   * A group from a different run names occurrences the current list does not have.
   * The obvious implementation filters the list down to what a group names, and
   * that silently deletes a real finding from the user's document because a
   * bookkeeping field is out of step with it.
   */
  it("keeps every finding when a group names occurrences this run did not produce", () => {
    const real = finding({ id: "current" });
    const { units, staleGroups } = resolveFindingGroups(
      [group({ occurrenceIds: ids("from-another-run", "also-another") })],
      [real],
    );

    expect(units).toEqual([{ kind: "single", finding: real }]);
    expect(staleGroups).toHaveLength(1);
  });

  it("reports a group whose occurrences are only partly present as partly missing", () => {
    const kept = finding({ id: "kept", range: { start: 5, end: 7, unit: "character" } });
    const { units } = resolveFindingGroups(
      [group({ occurrenceIds: ids("kept", "gone"), safeBatchApproval: false })],
      [kept],
    );

    expect(units[0]?.kind).toBe("group");
    if (units[0]?.kind === "group") {
      expect(units[0].missing).toBe(1);
      expect(units[0].findings).toHaveLength(1);
    }
  });

  it("keeps a finding no group claimed, so grouping never loses one", () => {
    const grouped = finding({ id: "g1" });
    const loose = finding({ id: "l1", category: "typography.ellipsis" });
    const { units } = resolveFindingGroups([group({ occurrenceIds: ids("g1") })], [grouped, loose]);

    expect(units).toHaveLength(2);
    expect(units.some((unit) => unit.kind === "single" && unit.finding.id === idOf("l1"))).toBe(
      true,
    );
  });

  /*
   * Two groups claiming one occurrence must not render it twice, or one
   * Approve-all could approve an occurrence another header still shows undecided.
   */
  it("gives a contested occurrence to the first group and still renders the loser once", () => {
    const contested = finding({ id: "c1" });
    const { units } = resolveFindingGroups(
      [
        group({ id: "first", occurrenceIds: ids("c1", "x1") }),
        group({ id: "second", occurrenceIds: ids("c1") }),
      ],
      [contested, finding({ id: "x1", range: { start: 20, end: 22, unit: "character" } })],
    );

    const rendered = units.flatMap((unit) =>
      unit.kind === "group" ? unit.findings.map((entry) => entry.id) : [unit.finding.id],
    );
    expect(rendered.filter((id) => id === idOf("c1"))).toHaveLength(1);
  });

  /*
   * Document order, not group order.
   *
   * The findings toolbar's next/previous steps an index into this list, so
   * reordering by group would make "Finding 3 of 12" land on a different card than
   * the reader expects while the header counts stay unchanged.
   */
  it("orders units by where their first occurrence sits in the document", () => {
    const early = finding({ id: "e", range: { start: 1, end: 3, unit: "character" } });
    const middle = finding({ id: "m", range: { start: 50, end: 52, unit: "character" } });
    const late = finding({ id: "l", range: { start: 90, end: 92, unit: "character" } });
    /*
     * The group lists its occurrences as ["l", "m"] — latest first — and is handed
     * to `resolveFindingGroups` before the one holding the earliest finding, so a
     * pass that trusted the group's own order would put the {l, m} unit first and
     * render the document backwards.
     *
     * The expected second entry is `m`, not `l`: a unit is anchored on its
     * *earliest* occurrence, and a group's members are sorted into document order
     * before the anchor is taken.
     */
    const { units } = resolveFindingGroups(
      [
        group({ id: "late-group", occurrenceIds: ids("l", "m") }),
        group({ id: "early-group", occurrenceIds: ids("e") }),
      ],
      [early, middle, late],
    );

    expect(
      units.map((unit) => (unit.kind === "group" ? unit.findings[0]?.id : unit.finding.id)),
    ).toEqual([idOf("e"), idOf("m")]);
  });

  it("orders the occurrences inside a group by document position", () => {
    const first = finding({ id: "f", range: { start: 1, end: 3, unit: "character" } });
    const second = finding({ id: "s", range: { start: 80, end: 82, unit: "character" } });
    const { units } = resolveFindingGroups(
      [group({ occurrenceIds: ids("s", "f") })],
      [first, second],
    );

    if (units[0]?.kind === "group") {
      expect(units[0].findings.map((entry) => entry.id)).toEqual(ids("f", "s"));
    } else {
      throw new Error("expected a group unit");
    }
  });
});

describe("describeGroup", () => {
  it("names the category, the count, and the correction", () => {
    expect(describeGroup(group({ expected: "—" }), 14)).toBe(
      "typography.emDash · 14 occurrences · corrects to —",
    );
  });

  it("says so when the group has no correction rather than printing undefined", () => {
    expect(describeGroup(group({ expected: undefined }), 3)).toContain("no automatic correction");
  });

  it("uses the singular for one occurrence", () => {
    expect(describeGroup(group(), 1)).toContain("1 occurrence ·");
  });
});

describe("undecidedIn", () => {
  it("counts every occurrence when nothing is decided", () => {
    const first = finding({ id: "a" });
    const second = finding({ id: "b", range: { start: 30, end: 32, unit: "character" } });
    const byId = new Map([
      [first.id, first],
      [second.id, second],
    ]);

    expect(undecidedIn(group({ occurrenceIds: ids("a", "b") }), byId, new Set())).toBe(2);
  });

  /*
   * Identity, not position or id.
   *
   * The store is keyed on `reviewIdentity`, so a count derived any other way would
   * report "2 still to decide" over a group the user had already approved — and
   * this codebase has already shipped two defects from a second identity key.
   */
  it("counts only what the store has not decided, by review identity", () => {
    const first = finding({ id: "a" });
    const second = finding({ id: "b", range: { start: 30, end: 32, unit: "character" } });
    const byId = new Map([
      [first.id, first],
      [second.id, second],
    ]);

    expect(
      undecidedIn(group({ occurrenceIds: ids("a", "b") }), byId, new Set([reviewIdentity(first)])),
    ).toBe(1);
  });

  it("ignores an occurrence this run no longer has", () => {
    const kept = finding({ id: "a" });
    expect(
      undecidedIn(
        group({ occurrenceIds: ids("a", "gone") }),
        new Map([[kept.id, kept]]),
        new Set(),
      ),
    ).toBe(1);
  });
});
