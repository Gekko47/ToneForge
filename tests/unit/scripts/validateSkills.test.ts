import { describe, expect, it, vi } from "vitest";
import { parseFrontmatter } from "../../../scripts/validate-skills.mjs";

/**
 * The frontmatter parser is hand-rolled, so its failure mode is silent: a value
 * it cannot read becomes a short string rather than an error. These tests pin
 * the two shapes that actually occur in this repository.
 *
 * - a folded scalar (`>-`) must read its continuation lines, not the indicator;
 * - a plain single-line value must be unchanged.
 */

function skill(body: string): string {
  return `---\n${body}\n---\n\n# Body\n\n## When to use\n\nAlways.\n`;
}

describe("parseFrontmatter", () => {
  it("reads a folded block scalar as one value, not the indicator token", () => {
    const parsed = parseFrontmatter(
      skill(
        "name: ponytail\ndescription: >-\n  Apply lazy senior dev principles before any\n  coding task.",
      ),
      "test/SKILL.md",
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.data.description).toBe(
      "Apply lazy senior dev principles before any coding task.",
    );
    expect(parsed?.data.description).not.toBe(">-");
  });

  it("reads a literal block scalar as one value, not the indicator token", () => {
    const parsed = parseFrontmatter(
      skill("name: ponytail\ndescription: |\n  First line.\n  Second line."),
      "test/SKILL.md",
    );
    expect(parsed?.data.description).toBe("First line.\nSecond line.");
    expect(parsed?.data.description).not.toBe("|");
  });

  it("retains blank lines so they count toward the description length limit", () => {
    const filler = "a".repeat(1020);
    const parsed = parseFrontmatter(
      skill(`name: ponytail\ndescription: >-\n  ${filler}\n\n\n\n\n  b`),
      "test/SKILL.md",
    );
    const description = parsed?.data.description ?? "";
    expect(description).toContain("\n");
    expect(description.length).toBeGreaterThan(1024);
  });

  it("stops folding at the first line that is not indented", () => {
    const parsed = parseFrontmatter(
      skill("name: ponytail\ndescription: >-\n  Folded text.\nname: other\n  not part of it"),
      "test/SKILL.md",
    );
    expect(parsed?.data.description).toBe("Folded text.");
    expect(parsed?.data.name).toBe("other");
  });

  it("leaves a plain single-line value untouched", () => {
    const parsed = parseFrontmatter(
      skill(
        "name: toneforge-llm\ndescription: Work with the LLM layer. Use when adding providers.",
      ),
      "test/SKILL.md",
    );
    expect(parsed?.data.name).toBe("toneforge-llm");
    expect(parsed?.data.description).toBe("Work with the LLM layer. Use when adding providers.");
  });

  it("returns null and reports a failure when frontmatter is absent", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const parsed = parseFrontmatter("# No frontmatter here\n", "test/SKILL.md");
    expect(parsed).toBeNull();
    expect(error).toHaveBeenCalledWith(
      "FAIL: test/SKILL.md: missing YAML frontmatter (--- name/description ---)",
    );
    error.mockRestore();
  });
});
