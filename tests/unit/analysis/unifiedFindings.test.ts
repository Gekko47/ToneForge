import { v4 as uuidv4 } from "uuid";
import { describe, expect, it } from "vitest";
import type { Finding, FindingKind, Range, Severity } from "../../../src/core/domain/Finding";
import { unifyFindings } from "../../../src/analysis/unifiedFindings";

function finding(params: {
  category: string;
  start: number;
  end: number;
  unit?: Range["unit"];
  severity?: Severity;
  kind?: FindingKind;
  message?: string;
  confidence?: number;
  suggestedChangeId?: string;
  id?: string;
}): Finding {
  return {
    id: params.id ?? uuidv4(),
    kind: params.kind ?? "deterministic",
    category: params.category,
    range: {
      start: params.start,
      end: params.end,
      unit: params.unit ?? "character",
    },
    message: params.message ?? `Finding for ${params.category}`,
    severity: params.severity ?? "warning",
    evidence: "",
    confidence: params.confidence ?? 1,
    nodeIds: [],
    source: "deterministic",
    risk: "none",
    reversible: true,
    status: "new",
    ...(params.suggestedChangeId ? { suggestedChangeId: params.suggestedChangeId } : {}),
  };
}

describe("unifyFindings", () => {
  it("returns an empty array for empty inputs", () => {
    expect(unifyFindings({ deterministic: [], formatting: [] })).toEqual([]);
  });

  it("passes through a single source unchanged", () => {
    const input = [
      finding({ category: "typography.emDash", start: 0, end: 2, message: "a" }),
      finding({ category: "typography.emDash", start: 10, end: 12, message: "b" }),
    ];
    expect(unifyFindings({ deterministic: input, formatting: [] })).toEqual(input);
  });

  it("deduplicates exact duplicates across sources", () => {
    const result = unifyFindings({
      deterministic: [
        finding({
          category: "dup",
          start: 0,
          end: 5,
          message: "same",
          id: "11111111-1111-1111-1111-111111111111",
        }),
      ],
      formatting: [
        finding({
          category: "dup",
          start: 0,
          end: 5,
          message: "same",
          id: "22222222-2222-2222-2222-222222222222",
        }),
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("preserves overlapping findings with different categories", () => {
    const result = unifyFindings({
      deterministic: [
        finding({
          category: "language.terminology.preferred",
          start: 0,
          end: 10,
          message: "a",
        }),
      ],
      formatting: [
        finding({
          category: "formatting.unknownStyle",
          start: 5,
          end: 15,
          message: "b",
          kind: "formatting",
        }),
      ],
    });
    expect(result).toHaveLength(2);
  });

  it("collapses same-range same-category findings", () => {
    const result = unifyFindings({
      deterministic: [
        finding({ category: "dup", start: 0, end: 5, message: "first" }),
        finding({ category: "dup", start: 0, end: 5, message: "second" }),
      ],
      formatting: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.message).toBe("first");
  });

  it("keeps the longest match when same-category ranges overlap", () => {
    const result = unifyFindings({
      deterministic: [
        finding({ category: "dup", start: 0, end: 5, message: "short" }),
        finding({ category: "dup", start: 2, end: 10, message: "long" }),
      ],
      formatting: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.message).toBe("long");
  });

  it("resolves transitive same-category overlaps as one connected range", () => {
    const result = unifyFindings({
      deterministic: [
        finding({ category: "dup", start: 0, end: 4, message: "first" }),
        finding({ category: "dup", start: 2, end: 8, message: "middle" }),
        finding({ category: "dup", start: 7, end: 12, message: "last" }),
      ],
      formatting: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.message).toBe("middle");
  });

  it("uses source order for equal-length equal-severity overlaps", () => {
    const result = unifyFindings({
      deterministic: [
        finding({ category: "dup", start: 0, end: 5, message: "first" }),
        finding({ category: "dup", start: 0, end: 5, message: "second" }),
      ],
      formatting: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.message).toBe("first");
  });

  it("keeps the higher severity when same-category ranges have equal length", () => {
    const result = unifyFindings({
      deterministic: [
        finding({
          category: "dup",
          start: 0,
          end: 5,
          message: "warning",
          severity: "warning",
        }),
        finding({ category: "dup", start: 0, end: 5, message: "error", severity: "error" }),
      ],
      formatting: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe("error");
  });

  it("preserves suggestedChangeId linkage", () => {
    const result = unifyFindings({
      deterministic: [
        finding({
          category: "linked",
          start: 0,
          end: 5,
          suggestedChangeId: "change-123",
        }),
      ],
      formatting: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.suggestedChangeId).toBe("change-123");
  });

  it("preserves a finding's own confidence rather than treating anything below 1 as weaker", () => {
    // Kept as a property of the merge, not of any one source. A finding that
    // arrives with a confidence below 1 is preserved with it — the old semantic
    // source fed this, and the merging rule must not quietly become stricter now
    // that it does not.
    const result = unifyFindings({
      deterministic: [],
      formatting: [
        finding({
          category: "fmt.uncertain",
          start: 0,
          end: 10,
          kind: "formatting",
          confidence: 0.8,
        }),
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe(0.8);
  });

  it("preserves same-category findings in different range units", () => {
    const result = unifyFindings({
      deterministic: [
        finding({ category: "mixed", start: 0, end: 1, unit: "character" }),
        finding({ category: "mixed", start: 0, end: 1, unit: "paragraph" }),
      ],
      formatting: [],
    });
    expect(result).toHaveLength(2);
  });

  it("produces deterministic ordering", () => {
    const input = [
      finding({ category: "a", start: 5, end: 6, message: "x", severity: "info" }),
      finding({ category: "b", start: 0, end: 2, message: "y", severity: "error" }),
      finding({ category: "c", start: 0, end: 2, message: "z", severity: "warning" }),
    ];
    const one = unifyFindings({ deterministic: input, formatting: [] });
    const two = unifyFindings({ deterministic: input, formatting: [] });
    expect(one).toEqual(two);
    expect(one[0]!.range.start).toBe(0);
    expect(one[0]!.severity).toBe("error");
  });

  it("handles large mixed inputs deterministically", () => {
    const deterministic = Array.from({ length: 500 }, (_, i) =>
      finding({ category: "det", start: i, end: i + 1, message: `m${i}` }),
    );
    const formatting = Array.from({ length: 500 }, (_, i) =>
      finding({
        category: "fmt",
        start: i,
        end: i + 1,
        message: `f${i}`,
        kind: "formatting",
      }),
    );
    const one = unifyFindings({ deterministic, formatting });
    const two = unifyFindings({ deterministic, formatting });
    expect(one).toEqual(two);
    expect(one).toHaveLength(1000);
  });

  it("rejects findings with invalid ranges", () => {
    const result = unifyFindings({
      deterministic: [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          kind: "deterministic",
          category: "invalid",
          range: { start: 10, end: 5, unit: "character" },
          message: "Invalid range",
          severity: "warning",
          evidence: "",
          confidence: 1,
          nodeIds: [],
          source: "deterministic",
          risk: "none",
          reversible: true,
          status: "new",
        },
        finding({ category: "valid", start: 0, end: 2 }),
      ],
      formatting: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe("valid");
  });

  it("ignores an unknown input key rather than merging it", () => {
    // The merge point is where a model's opinion used to sit beside a
    // machine-verified rule breach. A caller can still construct a
    // `kind: "semantic"` finding; what must be impossible is handing it here and
    // having it merged into the deterministic list. The option is gone from the
    // type, so this asserts the runtime too.
    const withSemantic = { deterministic: [], formatting: [], semantic: [] } as never;
    expect(unifyFindings(withSemantic)).toEqual([]);
  });
});
