/**
 * Occurrence groups, joined to the findings the pane is actually showing.
 *
 * **Why this module exists rather than reading `report.groups` in the Dashboard.**
 * The engine has always grouped equivalent occurrences (spec §13) and the verdict
 * has always been on the group — `safeBatchApproval`, `batchRefusalReason`. Nothing
 * consumed it, which is why the whole batch-approval module was unreachable (ND-7)
 * and why `report.groups` was computed and dropped (ND-9). The gap was presentation
 * *and* delivery: the groups the Dashboard could have reached belonged to the
 * preview run, whose findings issue separate uuids from the scan the list renders.
 * Joining those by id is the same defect the review gate had to be repaired for, so
 * the observer now carries its own run's groups and this module joins those to the
 * same run's findings.
 *
 * **The rule that matters: a finding is never dropped.** A group whose ids no longer
 * all resolve is stale, and the obvious implementation — filter the list to the
 * findings a group names — silently deletes a real finding from the user's document
 * because a bookkeeping field moved out of step. So every finding reaches a unit:
 * a resolvable group, a singleton, or — when two groups claim one occurrence — the
 * first, with the rest left as singletons rather than lost.
 *
 * **Why a group of one renders as a singleton.** A batch decision over one
 * occurrence is the same decision as the occurrence's own Approve button. Rendering
 * it as a group would put a header, a count and a disabled control above every card
 * in a document whose findings mostly stand alone, which is the noise UX-3 exists to
 * remove.
 *
 * Pure: no React, no Office, no storage. Every decision a control makes about a
 * group is testable without a host, which is what `batchApproval` relies on.
 */

import type { Finding } from "../core/domain/Finding";
import type { DeterministicFindingGroup } from "../analysis/deterministic/contracts";
import { reviewIdentity } from "./occurrenceIdentity";

/** One thing the review list renders. */
export type FindingUnit =
  | {
      kind: "group";
      group: DeterministicFindingGroup;
      /** The group's occurrences, in document order. Never empty. */
      findings: Finding[];
      /**
       * Occurrence ids the group named that this run did not produce.
       *
       * Non-zero means the group is from a different run than the findings beside
       * it, and approving it would decide occurrences that are not on screen. The
       * batch module refuses on the same condition; this is the pane's chance to
       * say so before the button is pressed rather than after.
       */
      missing: number;
    }
  | { kind: "single"; finding: Finding };

export interface ResolvedGroups {
  units: FindingUnit[];
  /** Groups that named no occurrence in this run, and so render nothing. */
  staleGroups: DeterministicFindingGroup[];
}

/**
 * Join the run's groups to the run's findings, in document order.
 *
 * `findings` arrives already filtered — the pane removes ignored occurrences before
 * this point — so a group whose only remaining member is ignored resolves to a
 * group of one, not to a stale group. An ignored occurrence is a decision the user
 * already made, and re-reporting it as missing would be the pane arguing with them.
 */
export function resolveFindingGroups(
  groups: readonly DeterministicFindingGroup[],
  findings: readonly Finding[],
): ResolvedGroups {
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const order = new Map(findings.map((finding, index) => [finding.id, index]));
  const claimed = new Set<string>();
  const units: FindingUnit[] = [];
  const staleGroups: DeterministicFindingGroup[] = [];

  groups.forEach((group) => {
    const members = group.occurrenceIds
      .map((id) => byId.get(id))
      .filter((finding): finding is Finding => finding !== undefined)
      .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));

    if (members.length === 0) {
      staleGroups.push(group);
      return;
    }

    /*
     * First group wins a contested occurrence.
     *
     * The engine buckets by group key, so two groups cannot share an occurrence —
     * but a group array arriving from a stored or hand-built source could, and
     * rendering the same card twice under two headers would let one Approve-all
     * approve it while the other header still showed it as undecided. The loser is
     * added to the singleton pool below, so it is still decided once.
     */
    const fresh = members.filter((finding) => !claimed.has(finding.id));
    fresh.forEach((finding) => claimed.add(finding.id));
    if (fresh.length === 0) return;

    /*
     * A group of one — meaning the engine grouped exactly one occurrence —
     * renders as a plain occurrence.
     *
     * Keyed on `occurrenceIds.length`, not on how many members resolved. A group
     * that *declares* two occurrences but resolves one has something to say to
     * the reader — one of them could not be shown and cannot be approved — and
     * collapsing that to a bare card hides the only warning it carries.
     */
    if (group.occurrenceIds.length === 1 && fresh.length === 1) {
      const only = fresh[0];
      if (only !== undefined) units.push({ kind: "single", finding: only });
      return;
    }

    /*
     * `missing` counts ids this run did not produce, not ids another group won.
     *
     * `members.length - fresh.length` is the wrong subtraction: it measures the
     * contested occurrences a previous group claimed, and reports those as
     * "missing from the document" — which is a different and wrong statement
     * about text that is very much present. The count the header needs is how
     * much of the group this run cannot account for, and that is the difference
     * between the group's declared size and what resolved.
     */
    units.push({
      kind: "group",
      group,
      findings: fresh,
      missing: group.occurrenceIds.length - members.length,
    });
  });

  /* Anything no group claimed keeps its own row, in document position. */
  findings.forEach((finding) => {
    if (claimed.has(finding.id)) return;
    claimed.add(finding.id);
    units.push({ kind: "single", finding });
  });

  return { units: inDocumentOrder(units, order), staleGroups };
}

/**
 * Sort units by where their first occurrence sits in the document.
 *
 * Without this the list would read as "all em dashes, then all spacing, then all
 * headers", reordering the document the user is looking at and breaking the
 * findings toolbar's next/previous, which steps an index into this list. A stable
 * sort keeps the existing order wherever two units start at the same offset.
 */
function inDocumentOrder(
  units: readonly FindingUnit[],
  order: ReadonlyMap<string, number>,
): FindingUnit[] {
  const firstIndex = (unit: FindingUnit): number => {
    const first = unit.kind === "group" ? unit.findings[0] : unit.finding;
    return first === undefined ? Number.MAX_SAFE_INTEGER : (order.get(first.id) ?? 0);
  };
  return units
    .map((unit, index) => ({ unit, index }))
    .sort(
      (left, right) => firstIndex(left.unit) - firstIndex(right.unit) || left.index - right.index,
    )
    .map((entry) => entry.unit);
}

/**
 * The sentence a group header carries, in the user's terms rather than the key's.
 *
 * The raw `occurrenceGroupKey` is a profile path such as `typography.emDash` — the
 * vocabulary of the profile editor, which a reader triaging a document does not
 * have. The category is the user-facing name of the rule and is what the cards
 * already print, so the header agrees with them.
 */
export function describeGroup(group: DeterministicFindingGroup, occurrences: number): string {
  const plural = occurrences === 1 ? "occurrence" : "occurrences";
  const correction =
    group.expected === undefined || group.expected === null
      ? "no automatic correction"
      : `corrects to ${renderExpected(group.expected)}`;
  return `${group.category} · ${occurrences} ${plural} · ${correction}`;
}

/** Render a group's expected value as a short, readable phrase. */
function renderExpected(expected: unknown): string {
  if (typeof expected === "string") return expected;
  if (typeof expected === "number" || typeof expected === "boolean") return String(expected);
  if (Array.isArray(expected)) return expected.map(renderExpected).join(" ");
  return "the profile's standard";
}

/**
 * How many of a group's occurrences are still undecided.
 *
 * Read by the group header so a partly-decided group is described by what is left
 * rather than by what it once held. `batchApproval` computes the same set from the
 * same identities; this is the count beside the button, not the gate.
 *
 * `reviewIdentity` and not a local derivation, which is the whole point: this
 * codebase has already had two defects from a second, near-identical identity — the
 * ignore path keying on a fingerprint hid every occurrence of a rule, and the gate
 * keying on a uuid could never match across runs. A third would be the same bug
 * wearing a new hat.
 */
export function undecidedIn(
  group: DeterministicFindingGroup,
  byId: ReadonlyMap<string, Finding>,
  decided: ReadonlySet<string>,
): number {
  return group.occurrenceIds.reduce((count, id) => {
    const finding = byId.get(id);
    if (finding === undefined || decided.has(reviewIdentity(finding))) return count;
    return count + 1;
  }, 0);
}
