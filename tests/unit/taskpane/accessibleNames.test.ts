/**
 * An icon-only control has no text to name it, so it must be named explicitly.
 *
 * The plan's P12 gate covers keyboard, focus, screen-reader labels, axe, and
 * dialog focus (criteria 25–27). Most of that is Fluent's baseline or is
 * asserted elsewhere: the focus-visible outline is guarded in
 * `nativeFieldMarkers.test.ts`, the single live region in the Dashboard and
 * DebuggingPanel tests, and the navigation drawer's focus trap and restore in
 * `TaskPaneHeader.test.tsx`. axe and real screen-reader announcement are manual
 * evidence (plan §11.2) — no axe dependency is added for them (Ponytail).
 *
 * What is left, and what this file guards, is the one thing a text scan can
 * prove: a `Button` that renders only an icon and no text child carries an
 * `aria-label` (or `title`/`aria-labelledby`). A button with a visible label
 * needs none, so the guard only fires on the icon-only case.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
const TASKPANE = join(ROOT, "src", "taskpane");

function tsxFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

/** Strips comments so a doc naming a tag is not read as a tag. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

interface ButtonTag {
  tag: string;
  selfClosing: boolean;
  children: string;
}

/**
 * Every `<Button …>` opening tag, its self-closing flag, and its children.
 *
 * The opening tag is read by walking brace depth, because an `icon={<X />}`
 * prop contains a `>` that a naive `indexOf(">")` would mistake for the tag's
 * end.
 */
function buttonTags(source: string): ButtonTag[] {
  const results: ButtonTag[] = [];
  const open = /<Button\b/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(source)) !== null) {
    const start = match.index;
    let i = start + "<Button".length;
    let depth = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
      i += 1;
    }
    const tag = source.slice(start, i + 1);
    const selfClosing = tag.trimEnd().endsWith("/>");
    let children = "";
    if (!selfClosing) {
      const close = source.indexOf("</Button>", i);
      children = close === -1 ? "" : source.slice(i + 1, close);
    }
    results.push({ tag, selfClosing, children });
  }
  return results;
}

describe("accessible names in the task pane", () => {
  it("names every icon-only button, so no control is announced as just 'button'", () => {
    const offenders = tsxFiles(TASKPANE).flatMap((file) => {
      const source = withoutComments(readFileSync(file, "utf8"));
      return buttonTags(source)
        .filter((button) => button.tag.includes("icon="))
        .filter((button) => button.selfClosing || !/[A-Za-z]/.test(button.children))
        .filter(
          (button) =>
            !button.tag.includes("aria-label") &&
            !button.tag.includes("aria-labelledby") &&
            !button.tag.includes("title"),
        )
        .map(() => file.replace(/\\/g, "/"));
    });

    // Read back as an array so a failure names the files rather than a count.
    expect(offenders).toEqual([]);
  });
});
