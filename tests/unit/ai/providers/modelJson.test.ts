import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  parseModelJson,
  parseModelJsonArray,
  parseModelJsonArrayLoose,
} from "../../../../src/ai/providers/modelJson";

const claimSchema = z.object({
  subject: z.string(),
  claim: z.string(),
});

const itemSchema = z.object({
  id: z.string(),
  text: z.string(),
});

describe("parseModelJson", () => {
  it("parses bare JSON", () => {
    const result = parseModelJson('{"subject":"tone","claim":"formal"}', claimSchema);
    expect(result).toEqual({ subject: "tone", claim: "formal" });
  });

  it("parses fenced JSON with a json tag", () => {
    const text = '```json\n{"subject":"voice","claim":"active"}\n```';
    const result = parseModelJson(text, claimSchema);
    expect(result).toEqual({ subject: "voice", claim: "active" });
  });

  it("parses fenced JSON without a tag", () => {
    const text = '```\n{"subject":"register","claim":"neutral"}\n```';
    const result = parseModelJson(text, claimSchema);
    expect(result).toEqual({ subject: "register", claim: "neutral" });
  });

  it("parses JSON preceded by prose", () => {
    const text = 'Here are the claims:\n{"subject":"tone","claim":"formal"}';
    const result = parseModelJson(text, claimSchema);
    expect(result).toEqual({ subject: "tone", claim: "formal" });
  });

  it("parses JSON followed by prose", () => {
    const text = '{"subject":"tone","claim":"formal"}\nLet me know if you need changes.';
    const result = parseModelJson(text, claimSchema);
    expect(result).toEqual({ subject: "tone", claim: "formal" });
  });

  it("parses JSON surrounded by prose on both sides", () => {
    const text = 'Here is the extraction:\n{"subject":"voice","claim":"active"}\nHope this helps!';
    const result = parseModelJson(text, claimSchema);
    expect(result).toEqual({ subject: "voice", claim: "active" });
  });

  it("returns null for invalid JSON", () => {
    const result = parseModelJson("not json at all", claimSchema);
    expect(result).toBeNull();
  });

  it("returns null for JSON that does not satisfy the schema", () => {
    const result = parseModelJson('{"subject":"tone"}', claimSchema);
    expect(result).toBeNull();
  });

  it("returns null for an empty string", () => {
    const result = parseModelJson("", claimSchema);
    expect(result).toBeNull();
  });

  it("returns null for prose with no JSON", () => {
    const result = parseModelJson("I cannot extract claims from this.", claimSchema);
    expect(result).toBeNull();
  });

  it("returns null for a JSON array when an object is expected", () => {
    const result = parseModelJson('[{"subject":"tone","claim":"formal"}]', claimSchema);
    expect(result).toBeNull();
  });

  it("parses a JSON array when an array schema is expected", () => {
    const arraySchema = z.array(claimSchema);
    const result = parseModelJson('[{"subject":"tone","claim":"formal"}]', arraySchema);
    expect(result).toEqual([{ subject: "tone", claim: "formal" }]);
  });

  it("handles whitespace and newlines inside the JSON", () => {
    const text = '{\n  "subject": "tone",\n  "claim": "formal"\n}';
    const result = parseModelJson(text, claimSchema);
    expect(result).toEqual({ subject: "tone", claim: "formal" });
  });

  it("handles a fenced block with leading whitespace before the fence", () => {
    const text = '  ```json\n{"subject":"tone","claim":"formal"}\n```';
    const result = parseModelJson(text, claimSchema);
    expect(result).toEqual({ subject: "tone", claim: "formal" });
  });
});

describe("parseModelJsonArray", () => {
  it("parses a bare array", () => {
    const text = '[{"id":"1","text":"hello"},{"id":"2","text":"world"}]';
    const result = parseModelJsonArray(text, itemSchema);
    expect(result).toEqual([
      { id: "1", text: "hello" },
      { id: "2", text: "world" },
    ]);
  });

  it("parses a fenced array", () => {
    const text = '```json\n[{"id":"1","text":"hello"}]\n```';
    const result = parseModelJsonArray(text, itemSchema);
    expect(result).toEqual([{ id: "1", text: "hello" }]);
  });

  it("parses an array wrapped in an items object", () => {
    const text = '{"items":[{"id":"1","text":"hello"}]}';
    const result = parseModelJsonArray(text, itemSchema);
    expect(result).toEqual([{ id: "1", text: "hello" }]);
  });

  it("parses an array wrapped in a claims object", () => {
    const text = '{"claims":[{"id":"1","text":"hello"}]}';
    const result = parseModelJsonArray(text, itemSchema);
    expect(result).toEqual([{ id: "1", text: "hello" }]);
  });

  it("parses an array wrapped in an object with prose before it", () => {
    const text = 'Here are the items:\n{"items":[{"id":"1","text":"hello"}]}';
    const result = parseModelJsonArray(text, itemSchema);
    expect(result).toEqual([{ id: "1", text: "hello" }]);
  });

  it("returns null for invalid JSON", () => {
    const result = parseModelJsonArray("not json", itemSchema);
    expect(result).toBeNull();
  });

  it("returns null when array items do not satisfy the schema", () => {
    const text = '[{"id":"1"}]';
    const result = parseModelJsonArray(text, itemSchema);
    expect(result).toBeNull();
  });

  it("returns null for an empty string", () => {
    const result = parseModelJsonArray("", itemSchema);
    expect(result).toBeNull();
  });

  it("returns null for an object with no array values", () => {
    const text = '{"foo":"bar"}';
    const result = parseModelJsonArray(text, itemSchema);
    expect(result).toBeNull();
  });

  it("returns null when the wrapped array fails schema validation", () => {
    const text = '{"items":[{"wrong":"shape"}]}';
    const result = parseModelJsonArray(text, itemSchema);
    expect(result).toBeNull();
  });

  it("handles an empty array", () => {
    const result = parseModelJsonArray("[]", itemSchema);
    expect(result).toEqual([]);
  });

  it("handles an empty wrapped array", () => {
    const result = parseModelJsonArray('{"items":[]}', itemSchema);
    expect(result).toEqual([]);
  });
});

describe("parseModelJsonArrayLoose", () => {
  it("keeps the valid items and drops the invalid ones", () => {
    const text = '[{"id":"1","text":"hello"},{"id":"2"},{"id":"3","text":"world"}]';
    const result = parseModelJsonArrayLoose(text, itemSchema);
    expect(result).toEqual([
      { id: "1", text: "hello" },
      { id: "3", text: "world" },
    ]);
  });

  it("keeps the valid items in a wrapped array", () => {
    const text = '{"items":[{"id":"1","text":"hello"},{"wrong":"shape"}]}';
    const result = parseModelJsonArrayLoose(text, itemSchema);
    expect(result).toEqual([{ id: "1", text: "hello" }]);
  });

  it("returns an empty array when every item is invalid", () => {
    const result = parseModelJsonArrayLoose('[{"id":"1"},{"id":"2"}]', itemSchema);
    expect(result).toEqual([]);
  });

  it("returns null for invalid JSON", () => {
    const result = parseModelJsonArrayLoose("not json", itemSchema);
    expect(result).toBeNull();
  });

  it("returns null for an object with no array values", () => {
    const result = parseModelJsonArrayLoose('{"foo":"bar"}', itemSchema);
    expect(result).toBeNull();
  });

  it("returns null for an empty string", () => {
    const result = parseModelJsonArrayLoose("", itemSchema);
    expect(result).toBeNull();
  });

  it("handles an empty array", () => {
    const result = parseModelJsonArrayLoose("[]", itemSchema);
    expect(result).toEqual([]);
  });
});
