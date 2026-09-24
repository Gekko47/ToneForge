/**
 * Deterministic formatting normalizer.
 *
 * Maps formatting `Finding` objects onto typed `Change` payloads that the
 * Word revision adapter can apply. Pure: no Office, no LLM, no UI imports —
 * fully unit-testable without Word.
 *
 * Boundary rule: this module may only import from `core/domain` and
 * `shared/utils` (see docs/architecture.md and ADR-0006).
 */

import { v4 as uuidv4 } from "uuid";
import type { Change, ChangeRange } from "../core/domain/Change";
import type { Finding } from "../core/domain/Finding";
import type { FormattingSnapshot } from "./formattingSnapshot";

export interface NormalizeOptions {
  snapshot: FormattingSnapshot;
  findings: Finding[];
}

/** Convert formatting findings into `Change` objects. */
export function normalizeFormatting(options: NormalizeOptions): Change[] {
  const { snapshot, findings } = options;
  const changes: Change[] = [];

  findings.forEach((finding) => {
    const paraIndex = finding.range.start;
    if (paraIndex < 0 || paraIndex >= snapshot.paragraphs.length) return;
    const para = snapshot.paragraphs[paraIndex];
    if (!para) return;

    const range: ChangeRange = { start: paraIndex, end: paraIndex + 1 };

    switch (finding.category) {
      case "formatting.unknownStyle":
      case "formatting.emptyStyle":
        changes.push(
          createChange({
            type: "applyStyle",
            range,
            payload: { styleName: "Normal" },
            rationale: finding.message,
            findingId: finding.id,
          }),
        );
        break;
      case "formatting.directFormatting":
        changes.push(
          createChange({
            type: "resetCharacterFormatting",
            range,
            payload: {},
            rationale: `Clear direct formatting on paragraph ${paraIndex}`,
            findingId: finding.id,
          }),
        );
        break;
      case "formatting.listLevel":
        changes.push(
          createChange({
            type: "setListLevel",
            range,
            payload: { level: 0 },
            rationale: finding.message,
            findingId: finding.id,
          }),
        );
        break;
      case "formatting.emptyHeading":
        changes.push(
          createChange({
            type: "applyStyle",
            range,
            payload: { styleName: "Normal" },
            rationale: finding.message,
            findingId: finding.id,
          }),
        );
        break;
      case "formatting.headingHierarchy":
        changes.push(
          createChange({
            type: "applyStyle",
            range,
            payload: { styleName: `Heading ${headingFromPrevious(snapshot, paraIndex)}` },
            rationale: finding.message,
            findingId: finding.id,
          }),
        );
        break;
      default:
        break;
    }
  });

  return changes;
}

function createChange(params: {
  type: Change["type"];
  range: ChangeRange;
  payload: Record<string, unknown>;
  rationale: string;
  findingId: string;
}): Change {
  return {
    id: uuidv4(),
    type: params.type,
    range: params.range,
    payload: params.payload,
    rationale: params.rationale,
    reversible: true,
  } as Change;
}

const HEADING_RE = /^heading\s+(\d+)$/i;

function headingFromPrevious(snapshot: FormattingSnapshot, index: number): number {
  const previous = snapshot.paragraphs
    .slice(0, index)
    .reverse()
    .map((para) => para.styleName.trim())
    .find((style) => HEADING_RE.test(style));
  if (previous) {
    const match = previous.match(HEADING_RE);
    const level = match?.[1];
    if (level !== undefined) return Number.parseInt(level, 10) + 1;
  }
  return 1;
}
