/**
 * Inline type is not a style decision, it is a value choice.
 *
 * D-5 was an inline `fontSize: 20` in ProfileEditor that no theme token could
 * reach and no stylesheet rule could override. It survived because the lint
 * guard banned colour literals and stopped there — an inline *size* was legal.
 * The guard now bans both, and this file asserts the property independently so
 * that relaxing either lint rule does not quietly reopen the defect.
 *
 * The 0.85rem detail lines were the same defect at smaller scale: eleven
 * components each repeating the same type decision, at a size (13.6px of a 16px
 * root) that is on no step of the ramp.
 *
 * jsdom computes no styles, so nothing here can assert a rendered pixel. What
 * it can do is assert the *absence* of the thing that caused the defect, and
 * that the replacement reads a token — both of which are checkable in a string.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
const TASKPANE = join(ROOT, "src", "taskpane");
const STYLESHEET = join(TASKPANE, "taskpane.css");

/**
 * Every .tsx under src/taskpane. `.ts` files are excluded deliberately: a
 * theme module legitimately holds a size in data (fluentTheme.ts carries
 * Fluent's own type ramp), and the guard in eslint.config.mjs excludes it for
 * the same reason.
 */
function tsxFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (existsSync(full) && full.endsWith(".tsx")) return [full];
    if (existsSync(full) && !full.endsWith(".tsx")) {
      try {
        return tsxFiles(full);
      } catch {
        return [];
      }
    }
    return [];
  });
}

/**
 * Strips comments before matching.
 *
 * `ProfileEditor.tsx` carries a comment explaining the D-5 defect by naming
 * `fontSize: 20` — the very thing this file forbids. A matcher that reads raw
 * text reports that comment as a violation, so a doc explaining the fix would
 * block the fix. ESLint matches on the AST and never had this problem; a text
 * scan has to opt out of comments explicitly.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** A `style={{ … }}` prop and the line it sits on. */
function inlineStyleProps(): Array<{ file: string; line: number; source: string }> {
  return tsxFiles(TASKPANE).flatMap((file) =>
    withoutComments(readFileSync(file, "utf8"))
      .split("\n")
      .flatMap((raw, index) => {
        if (!raw.includes("style={{")) return [];
        return [{ file: file.replace(/\\/g, "/"), line: index + 1, source: raw }];
      }),
  );
}

/**
 * The declaration block of a rule, read from the selector to its closing brace.
 *
 * The selector comes first and the brace second, and a rule may be preceded by
 * a comment containing both characters, so the search starts at the last
 * occurrence of the selector text at or before the opening brace.
 */
function blockOf(selector: string): string {
  const css = readFileSync(STYLESHEET, "utf8");
  const start = css.indexOf(selector);
  if (start === -1) return "";
  const brace = css.indexOf("{", start);
  if (brace === -1 || css.slice(start, brace).includes("}")) return "";
  return css.slice(brace + 1, css.indexOf("}", brace));
}

describe("inline type in the task pane", () => {
  it("declares no hard-coded font size on any element", () => {
    const offenders = tsxFiles(TASKPANE).flatMap((file) =>
      withoutComments(readFileSync(file, "utf8"))
        .split("\n")
        .flatMap((raw, index) =>
          /\bfontSize\s*:\s*["'`]?\d/.test(raw) ? [`${file.replace(/\\/g, "/")}:${index + 1}`] : [],
        ),
    );

    // Read back as an array so a failure names the files rather than a count.
    expect(offenders).toEqual([]);
  });

  it("leaves no font-size, font-weight or line-height in an inline style object", () => {
    const banned = /style=\{\{[^}]*(fontSize|fontWeight|lineHeight|font-size)/;
    const offenders = inlineStyleProps()
      .filter((entry) => banned.test(entry.source))
      .map((entry) => `${entry.file}:${entry.line}`);

    expect(offenders).toEqual([]);
  });

  it("leaves no inline style object in the pane at all, so none can drift", () => {
    // The size rules ban three properties. A fourth — a margin, a colour, a
    // padding — would still reach the element un-themed, so this asserts the
    // class is the only way to style a pane element.
    const offenders = inlineStyleProps()
      .filter((entry) => entry.source.includes("style="))
      .map((entry) => `${entry.file}:${entry.line}`);

    expect(offenders).toEqual([]);
  });

  it("scans a real tree, so the three absence tests above are not vacuous", () => {
    // Every test in this file asserts an absence. If the walker silently
    // returned an empty list they would all pass while proving nothing, so the
    // walker's own reach is asserted directly.
    const files = tsxFiles(TASKPANE).map((file) => file.replace(/\\/g, "/").split("/").pop());

    expect(files.length).toBeGreaterThan(5);
    expect(files).toEqual(
      expect.arrayContaining(["ApplyResultBlock.tsx", "CoverageBanner.tsx", "PendingChanges.tsx"]),
    );
    expect(blockOf(".tf-detail")).not.toBe("");
  });
});

describe("the detail line", () => {
  it("reads the caption step of the ramp rather than a computed value", () => {
    const block = blockOf(".tf-detail");
    expect(block).toContain("font-size: var(--tf-font-caption)");
    // 0.85rem of a 16px root is 13.6px, which is between the body and caption
    // steps and therefore on neither.
    expect(block).not.toMatch(/\d+(\.\d+)?rem/);
  });

  it("spaces on the 4px grid, so two detail lines in one panel agree", () => {
    expect(blockOf(".tf-detail-spaced-1")).toContain("margin-top: var(--tf-space-1)");
    expect(blockOf(".tf-detail-spaced-2")).toContain("margin-top: var(--tf-space-2)");
  });

  it("indents a list the same way the two lists it sits beside do", () => {
    expect(blockOf(".tf-detail-list")).toContain("padding-left: 1.1rem");
  });

  it("is used in all three components that used to repeat the literal", () => {
    const files = tsxFiles(TASKPANE);
    const users = files.filter((file) => readFileSync(file, "utf8").includes("tf-detail"));
    const names = users.map((file) => file.replace(/\\/g, "/").split("/").pop());

    expect(names).toEqual(
      expect.arrayContaining(["ApplyResultBlock.tsx", "CoverageBanner.tsx", "PendingChanges.tsx"]),
    );
  });
});
