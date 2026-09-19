import { describe, it, expect } from "vitest";
import { ChangeSchema } from "../../../../src/core/domain/Change";

describe("ChangeSchema", () => {
  const base = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    type: "insertText" as const,
    range: { start: 0, end: 5 },
    payload: { text: "hello" },
  };

  it("accepts a valid insertText change", () => {
    const result = ChangeSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("rejects insertText without payload.text", () => {
    const result = ChangeSchema.safeParse({ ...base, payload: {} });
    expect(result.success).toBe(false);
  });

  it("rejects insertText with empty payload.text", () => {
    const result = ChangeSchema.safeParse({ ...base, payload: { text: "" } });
    expect(result.success).toBe(false);
  });

  it("rejects applyStyle without styleName", () => {
    const result = ChangeSchema.safeParse({
      ...base,
      type: "applyStyle",
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("accepts applyStyle with styleName", () => {
    const result = ChangeSchema.safeParse({
      ...base,
      type: "applyStyle",
      payload: { styleName: "Normal" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects setListLevel without numeric level", () => {
    const result = ChangeSchema.safeParse({
      ...base,
      type: "setListLevel",
      payload: { level: "one" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts setListLevel with integer level", () => {
    const result = ChangeSchema.safeParse({
      ...base,
      type: "setListLevel",
      payload: { level: 2 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects range where start > end", () => {
    const result = ChangeSchema.safeParse({
      ...base,
      range: { start: 10, end: 5 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts range where start === end", () => {
    const result = ChangeSchema.safeParse({
      ...base,
      range: { start: 5, end: 5 },
    });
    expect(result.success).toBe(true);
  });
});
