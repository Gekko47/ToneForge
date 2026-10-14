/**
 * The findings-by-type projection.
 *
 * The review list currently renders findings in document order with occurrence
 * groups collapsed to singletons. A reader triaging a document with 400 findings
 * cannot see the forest for the trees: they need to know "what kinds of problems
 * are here" before they can decide where to start. This module projects the flat
 * findings list into type-grouped sections, each with a count, an icon, and a
 * clickable row that expands to reveal the findings.
 *
 * **Why `ruleId` is the key, not `category`.** A finding's `category` is the
 * user-facing name of the rule, but one rule can emit several closely related
 * categories (e.g. `typography/dashes` emits emDash and enDashSpacing). Grouping
 * by category would scatter one rule's findings across multiple groups. `ruleId`
 * is the stable identity the engine assigns, so grouping by it keeps a rule's
 * findings together. Falls back to `category` when `ruleId` is absent (e.g.
 * formatting findings from the shared analyzer).
 *
 * **Why icon + count + label.** The Editor's spell-checker groups findings by
 * type (grammar, spelling, style) with an icon and a count, so a user can see
 * at a glance what the document's problems are. This projection mirrors that
 * pattern: each group row shows the type's icon, its human-readable label, and
 * how many findings it holds.
 *
 * Pure: no React, no Office, no storage. Every decision a control makes about a
 * group is testable without a host.
 */

import type { Finding } from "../core/domain/Finding";
import type { ToneForgeIconName } from "./theme/icons";

/** One type-grouped section of the findings list. */
export interface FindingTypeGroup {
  /** The rule identity this group is keyed on (`ruleId` or `category` fallback). */
  key: string;
  /**
   * The human-readable label — the finding's category.
   *
   * This is the category the finding itself prints, so the row and the card
   * beneath it name the same thing.
   */
  label: string;
  /**
   * The rule this group is about, in the profile editor's own words.
   *
   * `label` is the category — `typography.whitespace` — which is a key, not a
   * sentence, and a reader triaging a document does not have the profile editor
   * open. `ruleName` is the name the profile editor gives that rule: "Whitespace
   * and spacing". The heading says what the group *is*.
   */
  ruleName: string;
  /**
   * The parent the rule belongs to, in the same words.
   *
   * "if it is Whitespace findings, Whitespace must be the heading, Typography
   * the parent can be smaller non-bold subtext below it". The parent is what
   * groups the rows above the fold, so a reader sees the shape of the document
   * before the detail.
   */
  parent: string;
  /** The icon representing this type. */
  icon: ToneForgeIconName;
  /** How many findings this group holds. */
  count: number;
  /** The findings in this group, in document order. */
  findings: Finding[];
}

/**
 * The domain a rule belongs to, in the profile editor's own words.
 *
 * Keyed on the category's first segment — the same segmentation the icon uses —
 * so a domain with no entry of its own falls back to the generic label rather
 * than to a blank line.
 */
const CATEGORY_DOMAINS: Record<string, string> = {
  typography: "Typography",
  language: "Language",
  formatting: "Document formatting",
  houseStyle: "House style",
};

/**
 * The rule a finding belongs to, named the way the profile editor names it.
 *
 * Most categories carry their own name (`language.capitalisation.headingCase` is
 * about heading case). The ones that do not — the formatting findings, which are
 * keyed on the property that deviates — are named by the domain that owns them.
 * A name is always returned: a row whose only text is a count is a row the reader
 * has to open to understand.
 */
export function describeCategory(category: string): { ruleName: string; parent: string } {
  const domain = CATEGORY_DOMAINS[category.split(".")[0] ?? ""] ?? "Style";
  const parts = category.split(".");
  if (parts.length === 1) return { ruleName: domain, parent: "Style" };
  const leaf = parts[parts.length - 1] ?? "";
  return { ruleName: leaf.charAt(0).toUpperCase() + leaf.slice(1), parent: domain };
}

/**
 * Map a finding's category to the icon that represents its type.
 *
 * The categories follow a dotted-path convention (`typography.emDash`,
 * `formatting.headingStyle`, `language.terminology.preferred`), so the icon is
 * derived from the first segment — the rule's own grouping. A category outside
 * the known set gets the generic `deterministicReview` icon rather than a
 * blank square.
 */
export function iconForCategory(category: string): ToneForgeIconName {
  const first = category.split(".")[0] ?? "";
  switch (first) {
    case "typography":
      return "styles";
    case "language":
      return "deterministicReview";
    case "formatting":
      return "styles";
    case "houseStyle":
      return "governance";
    default:
      return "deterministicReview";
  }
}

/**
 * Project a flat findings list into type-grouped sections.
 *
 * Groups are sorted by count descending, then by label ascending, so the most
 * common problems appear first and the list is stable across renders. Findings
 * within each group preserve document order. Every finding appears in exactly
 * one group — the projection is total by construction.
 */
export function projectFindingsByType(findings: readonly Finding[]): FindingTypeGroup[] {
  const byKey = new Map<string, FindingTypeGroup>();
  const order: string[] = [];

  findings.forEach((finding) => {
    const key = finding.ruleId ?? finding.category;
    const existing = byKey.get(key);
    if (existing !== undefined) {
      existing.count += 1;
      existing.findings.push(finding);
      return;
    }
    const { ruleName, parent } = describeCategory(finding.category);
    const group: FindingTypeGroup = {
      key,
      label: finding.category,
      ruleName,
      parent,
      icon: iconForCategory(finding.category),
      count: 1,
      findings: [finding],
    };
    byKey.set(key, group);
    order.push(key);
  });

  return order
    .map((key) => byKey.get(key))
    .filter((group): group is FindingTypeGroup => group !== undefined)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}
