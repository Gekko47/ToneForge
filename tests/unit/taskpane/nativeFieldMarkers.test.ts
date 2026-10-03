/**
 * The native-field marker, and the rule it scopes (UX-4a).
 *
 * **The reported defect.** Profile Dropdowns and TextFields rendered
 * light-on-dark while the surrounding surface followed the theme. The stylesheet
 * tried to prevent that with `:not([class*="ms-"])`, a deny-list keyed on
 * Fluent's internal class prefix. It is replaced by a marker on *our* controls:
 * a deny-list asks "is this one of ours?", which no other library's naming can
 * answer, and it fails again for every Fluent component whose root is not an
 * `<input>`.
 *
 * **What is asserted, and why it is a source-level assertion.**
 *
 * jsdom computes no styles. `getComputedStyle` on a `.tf-native` input returns
 * an empty background in jsdom whatever the stylesheet says, in the light theme
 * and in the dark one alike. A test written that way would pass unconditionally
 * and prove nothing — which is worse than no test, because it reads as evidence.
 *
 * So these assert the two things that are actually checkable in a repository:
 *
 * 1. **The rule.** Every native-control declaration is scoped to the marker, and
 *    declares only theme tokens — no hard-coded light colour can reach a field.
 * 2. **The coverage.** Every `<input>`, `<select>` and `<textarea>` in the task
 *    pane carries the marker, so a control added tomorrow cannot silently fall
 *    outside the rules.
 *
 * The one thing neither can establish is what Word actually paints. That stays a
 * manual item in `docs/manual-verification.md`, and no green run here closes it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NATIVE_FIELD_CLASS } from "../../../src/taskpane/nativeField";

const ROOT = join(process.cwd(), "src", "taskpane");
const STYLESHEET = join(ROOT, "taskpane.css");

function readStylesheet(): string {
  return readFileSync(STYLESHEET, "utf8");
}

/**
 * The stylesheet with its comments removed.
 *
 * Needed because the comment above the new rule *explains* the old guard and
 * quotes it. Asserting against the raw file therefore fails on the very prose
 * that documents the fix — which is how the first version of the "no longer
 * excludes by Fluent's prefix" assertion proved it could not tell a selector
 * from a sentence about it.
 */
function selectorsOnly(): string {
  return readStylesheet().replace(/\/\*[\s\S]*?\*\//g, "");
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith(".tsx") ? [full] : [];
  });
}

/** Every native control the task pane renders, as source text. */
function nativeControls(): Array<{ file: string; index: number; source: string }> {
  return tsxFiles(ROOT).flatMap((file) => {
    const src = readFileSync(file, "utf8");
    const found: Array<{ file: string; index: number; source: string }> = [];
    const open = /<(input|select|textarea)\b/g;
    let match: RegExpExecArray | null;
    while ((match = open.exec(src)) !== null) {
      const end = src.indexOf(">", match.index);
      if (end === -1) continue;
      found.push({
        file: file.replace(`${ROOT}\\`, "").replace(/\\/g, "/"),
        index: found.length,
        source: src.slice(match.index, end + 1),
      });
    }
    return found;
  });
}

describe("the native-control stylesheet rule", () => {
  /*
   * The *scoping* of the rule is asserted in `theme.test.ts`, beside the other
   * stylesheet guards, because that is where "a bare element rule must not
   * return" already lives. Two files asserting the same selector would mean two
   * places to update the day the marker is renamed, and the second one to
   * discover it had been asserting a duplicate.
   *
   * What is left here is the half that test cannot reach: that the rule's
   * *content* is token-only, and that every control the rule is meant to reach
   * actually carries the marker.
   */
  it("scopes the native-control rule to the marker", () => {
    expect(selectorsOnly()).toContain(`.${NATIVE_FIELD_CLASS} {`);
    expect(selectorsOnly()).toContain(`select.${NATIVE_FIELD_CLASS} {`);
  });

  /*
   * The theme check, stated as a rule.
   *
   * A hard-coded light value here is exactly the reported defect: a field that
   * does not follow the theme. Asserting that every colour declaration in the
   * block is a `var(--tf-*)` token means a literal cannot be introduced here
   * without this failing.
   */
  it("declares only theme tokens, so no hard-coded light background can reach a field", () => {
    const css = readStylesheet();
    const block = css.slice(css.indexOf(`.${NATIVE_FIELD_CLASS} {`));
    const body = block.slice(0, block.indexOf("}"));

    const colourDeclarations = [...body.matchAll(/(background|color|border[a-z-]*)\s*:/g)];
    expect(colourDeclarations.length).toBeGreaterThan(0);
    colourDeclarations.forEach((declaration) => {
      const line = body.slice(body.lastIndexOf("\n", declaration.index) + 1).split(";")[0];
      expect(line).toContain("var(--tf-");
    });
    // And no literal light value anywhere in the block.
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(body).not.toMatch(/\b(white|black)\b/i);
  });

  it("keeps the theme-token contract for the placeholder rule too", () => {
    const css = readStylesheet();
    const start = css.indexOf(`input.${NATIVE_FIELD_CLASS}::placeholder`);
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).toContain("var(--tf-muted)");
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("every native control we render", () => {
  it("carries the marker, so it cannot fall outside the scoped rules", () => {
    const unmarked = nativeControls().filter(
      (control) => !control.source.includes(NATIVE_FIELD_CLASS),
    );
    expect(
      unmarked.map(
        (control) => `${control.file} #${control.index}: ${control.source.slice(0, 60)}`,
      ),
    ).toEqual([]);
  });

  it("is more than a token few, so the rule above is actually load-bearing", () => {
    // A test that finds one control proves the search works. This is what says
    // the marker is covering the editor rather than one leftover field.
    expect(nativeControls().length).toBeGreaterThan(20);
  });

  it("marks the editor's own controls, not only the semantic ones", () => {
    const files = new Set(nativeControls().map((control) => control.file));
    expect([...files].some((file) => file.includes("DeterministicStyleSections"))).toBe(true);
  });
});

describe("the marker itself", () => {
  it("is a ToneForge-owned class, not a Fluent one", () => {
    // If this ever starts with `ms-`, the rule has become a guess about another
    // library's naming again — the defect this replaced.
    expect(NATIVE_FIELD_CLASS.startsWith("tf-")).toBe(true);
    expect(NATIVE_FIELD_CLASS).not.toContain("ms-");
  });

  it("is distinct from the wrapper class, which is already on the labels", () => {
    // `tf-field` is on the <label> wrappers. Reusing it would put one class on
    // two elements for two unrelated reasons.
    expect(NATIVE_FIELD_CLASS).not.toBe("tf-field");
  });
});
