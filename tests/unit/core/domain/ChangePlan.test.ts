import { describe, it, expect } from "vitest";
import { ChangePlanSchema, createChangePlan } from "../../../../src/core/domain/index";
import type { ChangeSource } from "../../../../src/core/domain/Change";

const validChange = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  type: "insertText" as const,
  range: { start: 0, end: 5 },
  payload: { text: "hello" },
  rationale: "test",
  reversible: true,
  source: "deterministic" as ChangeSource,
  risk: "none" as const,
  approvalRequired: false,
  dependsOn: [],
};

describe("ChangePlanSchema", () => {
  it("accepts a valid plan", () => {
    const result = ChangePlanSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      docHash: "abc123",
      baseDocId: "doc-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      changes: [validChange],
      conflicts: [],
      stale: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid UUID for plan id", () => {
    const result = ChangePlanSchema.safeParse({
      id: "not-a-uuid",
      docHash: "abc123",
      baseDocId: "doc-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      changes: [validChange],
      conflicts: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid change id inside plan", () => {
    const result = ChangePlanSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      docHash: "abc123",
      baseDocId: "doc-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      changes: [{ ...validChange, id: "bad" }],
      conflicts: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty docHash", () => {
    const result = ChangePlanSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      docHash: "",
      baseDocId: "doc-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      changes: [validChange],
      conflicts: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty baseDocId", () => {
    const result = ChangePlanSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      docHash: "abc123",
      baseDocId: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      changes: [validChange],
      conflicts: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid createdAt date", () => {
    const result = ChangePlanSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      docHash: "abc123",
      baseDocId: "doc-1",
      createdAt: "not-a-date",
      changes: [validChange],
      conflicts: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty changes array", () => {
    const result = ChangePlanSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      docHash: "abc123",
      baseDocId: "doc-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      changes: [],
      conflicts: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("createChangePlan", () => {
  it("generates a UUID v4 id", () => {
    const plan = createChangePlan("abc123", "doc-1", [validChange]);
    expect(plan.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(plan.docHash).toBe("abc123");
    expect(plan.baseDocId).toBe("doc-1");
    expect(plan.stale).toBe(false);
    expect(plan.conflicts).toEqual([]);
  });

  it("throws on invalid change payload", () => {
    expect(() =>
      createChangePlan("abc123", "doc-1", [{ ...validChange, type: "applyStyle", payload: {} }]),
    ).toThrow();
  });
});
