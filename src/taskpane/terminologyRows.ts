/**
 * Creating terminology rules in bulk — the logic behind the "Add many terms" paste.
 *
 * **Why this is a module and not part of the editor component.** The single-add
 * button and the bulk paste must produce *identical* rules. Written inline, the
 * two would drift the moment a default changed — the paste would quietly create
 * a different kind of rule from the button beside it, and the symptom would only
 * show up as findings the user did not expect. Here the two call sites share one
 * factory, so they cannot disagree.
 *
 * **It is pure, so it is tested directly.** No rendering, no jsdom, no Office.
 * The behaviour worth pinning — skipping a term that is already there, refusing
 * a blank one, allocating ids that cannot collide — is all decidable from the
 * arguments.
 *
 * **Additive, never replacing.** A paste adds rules; it never edits or removes
 * one. A term already in the list is reported as skipped rather than silently
 * overwritten, because a user pasting twenty terms does not expect the three
 * they already tuned to lose their settings.
 */

import type { TerminologyRule } from "../core/domain/StyleProfile";

/** The severity a new rule starts at, matching the single-add button. */
export const NEW_RULE_SEVERITY = "advisory" as const;

/**
 * One new rule with the defaults the editor has always used.
 *
 * `replacement` is omitted rather than set to `undefined` when absent: the
 * schema treats "no replacement" and "an empty replacement" differently, and
 * omitting is what the single-add path does for a term the user has not filled
 * in yet.
 */
export function newTerminologyRule(
  id: string,
  source: string,
  replacement?: string,
): TerminologyRule {
  return {
    id,
    source,
    ...(replacement === undefined || replacement.length === 0 ? {} : { replacement }),
    caseSensitive: false,
    wholeWord: true,
    severity: NEW_RULE_SEVERITY,
    scope: {},
  };
}

/**
 * `count` ids, none of which any existing rule is using.
 *
 * Scans `term-1`, `term-2`, … and takes what is free, so a profile with
 * `term-1` and `term-3` still gets `term-2` back rather than a fresh
 * `term-<n+1>`. Taking gaps first also means the ids a profile already carries
 * stay where the user last saw them.
 */
export function nextTermIds(existing: readonly TerminologyRule[], count: number): string[] {
  const taken = new Set(existing.map((rule) => rule.id));
  const ids: string[] = [];
  let index = 0;
  while (ids.length < count) {
    index += 1;
    const candidate = `term-${index}`;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    ids.push(candidate);
  }
  return ids;
}

/** A single free id — the single-add path's shorthand. */
export function nextTermId(existing: readonly TerminologyRule[]): string {
  return nextTermIds(existing, 1)[0] ?? `term-${existing.length + 1}`;
}

/** One parsed `term: replacement` pair, and how it will be treated. */
export interface BulkTermOutcome {
  source: string;
  replacement: string;
  /**
   * `add` — a new rule.
   * `already-present` — the list already has a rule for this term.
   * `within-paste` — this paste names the same term twice.
   */
  outcome: "add" | "already-present" | "within-paste";
}

export interface BulkTermResult {
  /** The pairs that will become rules, in paste order. */
  readonly added: readonly BulkTermOutcome[];
  /** The pairs that will not, with the reason. */
  readonly skipped: readonly BulkTermOutcome[];
}

/**
 * Decide what a paste would do, without doing it.
 *
 * Returned separately from the mutation so the UI can show a count *before*
 * anything is written — a paste of two hundred lines should not be discovered
 * after the fact.
 *
 * **Matching is on the trimmed source, case-sensitively.** That is deliberate:
 * "colour" and "Colour" are two distinct rules a user may genuinely want (the
 * `caseSensitive` flag is per-rule, so a house can want both), and quietly
 * collapsing them would be a decision this function has no standing to make.
 */
export function planBulkTerms(
  pairs: Readonly<Record<string, string>>,
  existing: readonly TerminologyRule[],
): BulkTermResult {
  const present = new Set(existing.map((rule) => rule.source));
  const seenInPaste = new Set<string>();
  const added: BulkTermOutcome[] = [];
  const skipped: BulkTermOutcome[] = [];

  Object.entries(pairs).forEach(([rawSource, replacement]) => {
    const source = rawSource.trim();
    const candidate: BulkTermOutcome = { source, replacement, outcome: "add" };
    if (source.length === 0) {
      skipped.push({ ...candidate, outcome: "within-paste" });
      return;
    }
    if (present.has(source)) {
      skipped.push({ ...candidate, outcome: "already-present" });
      return;
    }
    if (seenInPaste.has(source)) {
      skipped.push({ ...candidate, outcome: "within-paste" });
      return;
    }
    seenInPaste.add(source);
    added.push(candidate);
  });

  return { added, skipped };
}

/**
 * Build the rules a plan calls for, against the list they will be added to.
 *
 * The ids are allocated in one pass over the *combined* list, so a paste of
 * three terms cannot hand the same id to two rows.
 */
export function buildBulkRules(
  plan: BulkTermResult,
  existing: readonly TerminologyRule[],
): TerminologyRule[] {
  const ids = nextTermIds(existing, plan.added.length);
  return plan.added.map((entry, index) => {
    const id = ids[index];
    // `plan.added` and `ids` are built from the same length, so this cannot be
    // undefined; the fallback keeps the type honest rather than asserting.
    return newTerminologyRule(id ?? `term-${index + 1}`, entry.source, entry.replacement);
  });
}
