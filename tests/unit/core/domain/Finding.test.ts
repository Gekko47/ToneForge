import { describe, it, expect } from "vitest";
import { FindingSchema, RangeSchema } from "../../../../src/core/domain/Finding";

describe("RangeSchema", () => {
  it("accepts valid range", () => {
    const result = RangeSchema.safeParse({ start: 0, end: 10, unit: "character" });
    expect(result.success).toBe(true);
  });

  it("rejects start > end", () => {
    const result = RangeSchema.safeParse({ start: 10, end: 5 });
    expect(result.success).toBe(false);
  });

  it("accepts start === end", () => {
    const result = RangeSchema.safeParse({ start: 5, end: 5 });
    expect(result.success).toBe(true);
  });
});

describe("FindingSchema", () => {
  const base = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    kind: "deterministic" as const,
    category: "em-dash",
    range: { start: 0, end: 5 },
    message: "Found em dash",
    severity: "warning" as const,
  };

  it("accepts a valid finding", () => {
    const result = FindingSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("rejects invalid UUID", () => {
    const result = FindingSchema.safeParse({ ...base, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects empty category", () => {
    const result = FindingSchema.safeParse({ ...base, category: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty message", () => {
    const result = FindingSchema.safeParse({ ...base, message: "" });
    expect(result.success).toBe(false);
  });

  it("rejects confidence outside 0-1", () => {
    const result = FindingSchema.safeParse({ ...base, confidence: 1.5 });
    expect(result.success).toBe(false);
  });
});
