/**
 * Deciding whether a finding is one the user has set aside.
 *
 * The bug this replaces: ignoring was decided by comparing
 * `findingFingerprint`, and the fingerprint excludes the range on purpose — it
 * is the identity of a *rule*, not of an occurrence. So a document with ninety
 * em-dashes produced ninety findings with one identity, and ignoring the first
 * hid all ninety. The user saw most of their findings disappear on one click,
 * with no list of what had gone and no way to bring it back.
 *
 * The fix is that the occurrence has to be matched separately from the rule.
 * An ignored entry stores the range it was created for, and a finding matches
 * when it is the same rule *and* sits at that position.
 *
 * Positions shift. An edit anywhere above the finding moves it, and a
 * fingerprint that included the exact offset would stop applying the first time
 * the user typed. So the position is compared with a tolerance rather than for
 * equality: close enough is the same occurrence, because an edit moves things
 * by the size of what changed, and two genuine occurrences of the same rule in
 * one paragraph are separated by the text between them rather than by nothing.
 *
 * The tolerance is deliberately generous. Being too generous costs one extra
 * finding staying hidden; being too tight costs an ignore that silently stops
 * working, which is the failure the user cannot see.
 */

import type { Finding, IgnoredFinding } from "../core/domain/Finding";
import { isSameIgnoredOccurrence } from "./occurrenceIdentity";

export function isIgnoredFinding(finding: Finding, entry: IgnoredFinding): boolean {
  return isSameIgnoredOccurrence(finding, entry);
}

/**
 * Whether any stored ignore covers this finding.
 *
 * A missing list is treated as an empty one. The store is Zod-validated and
 * defaults this field, so `undefined` means a partial state — a hand-edited
 * store, or a mock that predates the field — and a pane that cannot render
 * because of it would be worse than a pane that shows the findings unfiltered.
 */
export function isAnyIgnored(
  finding: Finding,
  entries: readonly IgnoredFinding[] | undefined,
): boolean {
  return (entries ?? []).some((entry) => isIgnoredFinding(finding, entry));
}

/** Filter out the findings the user has set aside. */
export function withoutIgnored(
  findings: readonly Finding[],
  entries: readonly IgnoredFinding[] | undefined,
): Finding[] {
  if (entries === undefined || entries.length === 0) return [...findings];
  return findings.filter((finding) => !isAnyIgnored(finding, entries));
}
