import { v4 as uuidv4 } from "uuid";
import { approvalPolicyForFinding } from "../../changes/approvalPolicy";
import { ChangeSchema, type Change } from "../../core/domain/Change";
import { FindingSchema, type Finding } from "../../core/domain/Finding";
import { SpotResponseSchema, type SpotResponse } from "../prompts/spotPrompts";

export interface ValidatedReview {
  findings: Finding[];
  changes: Change[];
}

export function validateReviewResponse(
  raw: unknown,
  context: {
    requestId: string;
    targetNodeIds: readonly string[];
    sourceText: string;
    rangeOffset?: number;
  },
): ValidatedReview {
  const rangeOffset = context.rangeOffset ?? 0;
  const response: SpotResponse = SpotResponseSchema.parse(raw);
  const findings: Finding[] = [];
  const changes: Change[] = [];

  response.findings.forEach((entry) => {
    if (entry.end < entry.start || entry.end > context.sourceText.length) {
      throw new Error("AI review returned a range outside the supplied context");
    }
    const exactSlice = context.sourceText.slice(entry.start, entry.end);
    if (entry.actual !== undefined && entry.actual !== exactSlice) {
      throw new Error("AI review actual does not match the exact source slice");
    }
    const actionable =
      entry.actual !== undefined && entry.expected !== undefined && entry.expected !== exactSlice;
    const finding = FindingSchema.parse({
      id: uuidv4(),
      kind: "semantic",
      category: entry.category,
      range: {
        start: entry.start + rangeOffset,
        end: entry.end + rangeOffset,
        unit: "character",
      },
      message: entry.explanation ?? entry.category,
      severity: entry.severity,
      evidence: entry.actual ?? "",
      nodeIds: [...context.targetNodeIds],
      source: "ai",
      risk: entry.risk,
      reversible: true,
      status: actionable ? "new" : "deferred",
      actionable,
      ...(!actionable && entry.actual === undefined
        ? { advisoryReason: "The model did not identify an exact source slice" }
        : {}),
      ...(entry.actual !== undefined ? { actual: entry.actual } : {}),
      ...(entry.expected !== undefined ? { expected: entry.expected } : {}),
      ...(entry.explanation !== undefined ? { explanation: entry.explanation } : {}),
      confidence: entry.confidence,
    });
    findings.push(finding);
    if (actionable && entry.expected !== undefined) {
      const approval = approvalPolicyForFinding(finding);
      const isDeletion = entry.expected.length === 0;
      changes.push(
        ChangeSchema.parse({
          id: uuidv4(),
          type: isDeletion ? "deleteRange" : "replaceText",
          range: { start: entry.start + rangeOffset, end: entry.end + rangeOffset },
          payload: isDeletion ? {} : { text: entry.expected },
          rationale: entry.explanation ?? entry.category,
          source: "ai",
          risk: entry.risk,
          ...approval,
          dependsOn: [],
          findingId: finding.id,
          reversible: true,
          precondition: { kind: "text", expectedText: exactSlice },
        }),
      );
    }
  });

  return { findings, changes };
}
