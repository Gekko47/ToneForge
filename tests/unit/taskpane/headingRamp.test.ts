/**
 * The heading ramp (S7).
 *
 * **Why a source-level assertion and not a computed-style one.** jsdom computes
 * no styles: `getComputedStyle` on an `<h2>` returns an empty string whatever
 * the stylesheet says. A test written that way would pass unconditionally and
 * read as evidence, which is worse than no test.
 *
 * So these assert the two things a repository can actually be checked on: that
 * every heading level has a rule, and that no rule comes from the user agent's
 * default. The second is the defect — roughly twenty-five `<h2>`s carried no
 * class and therefore rendered at whatever the browser decided, which is how a
 * page could show a 14px "h1" above a 24px "h2" above a 20px "h3".
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src", "taskpane");
const STYLESHEET = join(ROOT, "taskpane.css");

function css(): string {
  return readFileSync(STYLESHEET, "utf8");
}

/** The stylesheet with its comments removed. */
function selectorsOnly(): string {
  return css().replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The declarations in the block whose selector list *contains* `selector`.
 *
 * Matching on `selector + " {"` would miss `h1,\n.tf-title {`, which is exactly
 * how the h1 rule is written — and a helper that cannot find its own rule is
 * worse than no helper. So this reads back to the start of the selector list.
 */
function blockOf(selector: string): string {
  const source = selectorsOnly();
  const brace = source.indexOf("{", source.indexOf(selector));
  expect(brace).toBeGreaterThan(0);
  const boundary = Math.max(source.lastIndexOf("}", brace), source.lastIndexOf(";", brace));
  return source.slice(boundary + 1, source.indexOf("}", brace));
}

/** Every `<hN>` in the pane, as `file: tag`. */
function headings(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".tsx")) {
        const text = readFileSync(full, "utf8");
        ["h1", "h2", "h3", "h4"].forEach((tag) => {
          const pattern = new RegExp(`<${tag}\\b`, "g");
          while (pattern.exec(text) !== null) {
            found.push(`${full.replace(/\\/g, "/")}:${tag}`);
          }
        });
      }
    }
  };
  walk(ROOT);
  return found;
}

describe("the heading ramp", () => {
  it("gives every level a rule, so a bare heading cannot fall back to the browser", () => {
    // The core of the fix. A heading element with no rule renders at the user
    // agent's default size and margins, which is the inconsistency this exists
    // to remove.
    ["h1", "h2", "h3", "h4"].forEach((tag) => {
      expect(blockOf(tag)).toContain("font-size");
    });
  });

  it("uses Microsoft's six-step sizes, in px, from the Office add-in table", () => {
    const source = selectorsOnly();
    expect(source).toContain("--tf-font-title: 21px");
    expect(source).toContain("--tf-font-subtitle: 17px");
    expect(source).toContain("--tf-font-body: 14px");
    expect(source).toContain("--tf-font-caption: 12px");
    expect(source).toContain("--tf-font-annotation: 11px");
    // And every heading reads from the ramp rather than a literal, so changing
    // the ramp moves all of them together.
    expect(blockOf("h2")).toContain("var(--tf-font-subtitle)");
    expect(blockOf("h3")).toContain("var(--tf-font-body)");
  });

  it("declares the ramp once, outside both themes", () => {
    /*
     * Type is the shape of the interface, not its colour. A ramp declared inside
     * the theme blocks could give the same heading a different size in dark mode,
     * and nothing would flag it.
     */
    // Matched with the colon so a *use* (`var(--tf-font-title)`) is not counted
    // as a second declaration. The claim is "declared once", not "mentioned once".
    expect(selectorsOnly().match(/--tf-font-title\s*:/g)?.length).toBe(1);
  });

  it("keeps the ramp off the 4px spacing grid's rounding problems", () => {
    // Every size is a whole pixel and every space a multiple of four, so a pane
    // whose padding is token-driven lands on the same grid as its type.
    ["--tf-space-1: 4px", "--tf-space-2: 8px", "--tf-space-3: 12px", "--tf-space-4: 16px"].forEach(
      (token) => {
        expect(css()).toContain(token);
      },
    );
  });

  it("raises the page title to the Title size everywhere, not just on one page", () => {
    // D-d: `.tf-title` sits on nine h1s across the app. Changing it per-page was
    // explicitly rejected — uniformity was the point.
    expect(blockOf(".tf-title")).not.toContain("14px");
  });

  it("leaves no heading wearing a body class", () => {
    /*
     * `.tf-sub` is body copy. On an `<h2>` or `<h3>` it outranks the element rule
     * and renders the heading at body size — the misuse this checks, in the five
     * places it happened.
     */
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (entry.endsWith(".tsx")) {
          const text = readFileSync(full, "utf8");
          ["h1", "h2", "h3", "h4"].forEach((tag) => {
            const pattern = new RegExp(`<${tag}[^>]*className="([^"]*)"`, "g");
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(text)) !== null) {
              const classes = (match[1] ?? "").split(/\s+/);
              // `tf-sub` only. `tf-subheading` is a deliberate subheading style
              // and is allowed to set its own size on an `<h4>`; `tf-sub` is
              // body copy and has no business on a heading at all.
              if (classes.includes("tf-sub")) {
                offenders.push(`${full}:${match.index} ${tag} [${match[1]}]`);
              }
            }
          });
        }
      }
    };
    walk(ROOT);
    expect(offenders).toEqual([]);
  });

  it("still has headings to govern, so the rules are load-bearing", () => {
    // A ramp with no headings in the pane would pass the first test vacuously.
    expect(headings().length).toBeGreaterThan(30);
    // `lastIndexOf`, not `split(":")[1]`: a Windows path contains a drive colon.
    const tags = headings().map((entry) => entry.slice(entry.lastIndexOf(":") + 1));
    expect(new Set(tags)).toEqual(new Set(["h1", "h2", "h3", "h4"]));
  });
});
