import type { FindingTarget, Range } from "../core/domain/Finding";

/**
 * Where a finding is, in words a reader can act on.
 *
 * **Why this exists.** `FindingDetail` used to print
 * `Location: {range.start}–{range.end} ({range.unit})`. For a text finding that
 * is a character offset, which is at least honest. For a structural one it was
 * actively misleading: a table deviation produced `Location: 2–3 (section)`,
 * because `sectionRange(table.index)` had been reused for three different
 * structures, and the numbers meant a table index under a section's name.
 *
 * **The target is preferred; the range is the fallback.** Most findings have no
 * `target` — they are about text — and for those the range is the only thing
 * there is. A structural finding has both, and the target is the one that says
 * *which* table or *which* header, so it wins.
 *
 * **1-based, deliberately.** The range is 0-based because it feeds an offset
 * computation; this string is read by a person counting tables from one. A
 * reader who sees "Table 0" thinks the tool is broken.
 */
export function describeFindingLocation(input: {
  range: Range;
  target?: FindingTarget | undefined;
}): string {
  const { target } = input;
  if (target !== undefined) {
    const described = describeTarget(target);
    if (described !== null) return described;
  }
  return describeRange(input.range);
}

function describeTarget(target: FindingTarget): string | null {
  switch (target.kind) {
    case "text":
      return target.start === target.end
        ? `Character ${target.start + 1}`
        : `Characters ${target.start + 1}–${target.end}`;
    case "paragraph":
      return `Paragraph ${target.index + 1}`;
    case "list":
      return `List in paragraph ${target.paragraphIndex + 1}`;
    case "table":
      return `Table ${target.index + 1}`;
    case "header":
      return `Header ${target.index + 1} in section ${target.sectionIndex + 1}`;
    case "footer":
      return `Footer ${target.index + 1} in section ${target.sectionIndex + 1}`;
    case "section":
      return `Section ${target.index + 1}`;
  }
}

/**
 * The range on its own, when there is no target.
 *
 * Kept as a fallback rather than a second opinion: a finding whose target and
 * range disagree is a defect in the rule that produced it, and hiding the range
 * would hide that. The range is what every consumer already had.
 */
export function describeRange(range: Range): string {
  if (range.unit === "character") {
    return range.start === range.end
      ? `Character ${range.start + 1}`
      : `Characters ${range.start + 1}–${range.end}`;
  }
  const label = RANGE_UNIT_LABEL[range.unit];
  return `${label} ${range.start + 1}`;
}

const RANGE_UNIT_LABEL: Readonly<Record<Exclude<Range["unit"], "character">, string>> = {
  paragraph: "Paragraph",
  section: "Section",
  table: "Table",
  header: "Header",
  footer: "Footer",
};
