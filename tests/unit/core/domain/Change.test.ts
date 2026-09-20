import { describe, it, expect } from "vitest";
import { ChangeSchema, ChangeRangeSchema } from "../../../../src/core/domain/Change";

describe("ChangeRangeSchema", () => {
  it("accepts valid range", () => {
    const result = ChangeRangeSchema.safeParse({ start: 0, end: 10 });
    expect(result.success).toBe(true);
  });

  it("rejects negative start", () => {
    const result = ChangeRangeSchema.safeParse({ start: -1, end: 10 });
    expect(result.success).toBe(false);
  });

  it("rejects start > end", () => {
    const result = ChangeRangeSchema.safeParse({ start: 10, end: 5 });
    expect(result.success).toBe(false);
  });

  it("accepts start === end", () => {
    const result = ChangeRangeSchema.safeParse({ start: 5, end: 5 });
    expect(result.success).toBe(true);
  });
});

describe("ChangeSchema", () => {
  const base = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    type: "insertText" as const,
    range: { start: 0, end: 5 },
    payload: { text: "hello" },
    rationale: "",
    reversible: true,
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

  it("rejects insertText with non-string payload.text", () => {
    const result = ChangeSchema.safeParse({ ...base, payload: { text: 42 } });
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

  it("rejects applyStyle with empty styleName", () => {
    const result = ChangeSchema.safeParse({
      ...base,
      type: "applyStyle",
      payload: { styleName: "   " },
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

  it("rejects setListLevel with negative level", () => {
    const result = ChangeSchema.safeParse({
      ...base,
      type: "setListLevel",
      payload: { level: -1 },
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

  it("accepts deleteRange with empty payload", () => {
    const result = ChangeSchema.safeParse({
      ...base,
      type: "deleteRange",
      payload: {},
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown change type", () => {
    const result = ChangeSchema.safeParse({ ...base, type: "bogus" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID", () => {
    const result = ChangeSchema.safeParse({ ...base, id: "not-a-uuid" });
    expect(result.success).toBe(false);
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

  describe("setCharacterFormat payload", () => {
    const charBase = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      type: "setCharacterFormat" as const,
      range: { start: 0, end: 5 },
      rationale: "",
      reversible: true,
    };

    it("accepts name/size/color aligned with the revision adapter", () => {
      const result = ChangeSchema.safeParse({
        ...charBase,
        payload: { name: "Arial", size: 12, color: "#FF0000" },
      });
      expect(result.success).toBe(true);
    });

    it("accepts bold/italic/underline boolean flags", () => {
      const result = ChangeSchema.safeParse({
        ...charBase,
        payload: { bold: true, italic: false, underline: true },
      });
      expect(result.success).toBe(true);
    });

    it("accepts an empty payload", () => {
      const result = ChangeSchema.safeParse({ ...charBase, payload: {} });
      expect(result.success).toBe(true);
    });

    it("rejects non-string font name", () => {
      const result = ChangeSchema.safeParse({
        ...charBase,
        payload: { name: 12 },
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-number font size", () => {
      const result = ChangeSchema.safeParse({
        ...charBase,
        payload: { size: "twelve" },
      });
      expect(result.success).toBe(false);
    });
  });
});
