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
import { NATIVE_BUTTON_CLASS, NATIVE_FIELD_CLASS } from "../../../src/taskpane/nativeField";

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

/** A bare form element, optionally with a pseudo-class. */
const BARE_FORM_ELEMENT = /^(input|select|textarea|button)(:[\w-]+(\([^)]*\))?)?$/;

/** Every rule in `css` whose block declares a background or a text colour. */
function colourBearingRules(css: string): Array<{ selectors: string[] }> {
  const rules: Array<{ selectors: string[] }> = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(css)) !== null) {
    const [, selectorText, body] = match;
    if (selectorText === undefined || body === undefined) continue;
    if (!/(?:^|[\s;])(background|color)\s*:/.test(body)) continue;
    rules.push({
      selectors: selectorText
        .split(",")
        .map((selector) => selector.trim())
        .filter((selector) => selector.length > 0),
    });
  }
  return rules;
}

/**
 * The selector list of the rule whose block opens with `head`, as one selector
 * per entry.
 *
 * Reads backwards from the opening brace, so it sees the whole list rather than
 * the fragment that happens to sit nearest the block. Comments are already gone
 * by this point — a selector list interrupted by prose is still a selector list
 * to the CSS parser, which is exactly what made the original defect invisible.
 */
function selectorsOf(head: string): string[] {
  const css = selectorsOnly();
  const brace = css.indexOf(`${head} {`);
  expect(brace).toBeGreaterThan(-1);
  /*
   * Bounded by the nearest preceding `}` or `{`, not by the nearest `{` alone.
   * An unbounded backwards scan runs straight through the end of the rule above
   * and reports its declarations as part of this selector list — which is how a
   * helper written to catch a runaway selector can itself return nonsense.
   */
  const boundary = Math.max(css.lastIndexOf("}", brace), css.lastIndexOf("{", brace));
  /*
   * The slice ends at `brace`, which is the `{` *after* `.tf-native` — so the
   * marker selector itself is the tail of the range and has to be put back. A
   * helper that quietly drops the one selector it was asked about would report
   * an empty list for a correct stylesheet.
   */
  const list = css.slice(boundary + 1, brace + head.length + 1);
  return list
    .split(",")
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0);
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith(".tsx") ? [full] : [];
  });
}

/** Every `<tag>` of the given names the task pane renders, as source text. */
function tagsOf(name: string): Array<{ file: string; index: number; source: string }> {
  return tsxFiles(ROOT).flatMap((file) => {
    const src = readFileSync(file, "utf8");
    const found: Array<{ file: string; index: number; source: string }> = [];
    const open = new RegExp(`<(${name})\\b`, "g");
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

/** Every native form control the task pane renders. */
function nativeControls(): Array<{ file: string; index: number; source: string }> {
  return tagsOf("input|select|textarea");
}

/** Every button the task pane renders. */
function buttons(): Array<{ file: string; index: number; source: string }> {
  return tagsOf("button");
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
   * The regression this file exists to prevent, in its exact original shape.
   *
   * The rule once read `button, .tf-native { ... }`. The `button,` was left behind
   * when three `:not([class*="ms-"])` selectors were deleted out of the middle of
   * the list. Nothing about it was visible in the file, because the offending
   * selector sat above a forty-line comment and the `.tf-native {` that followed
   * it is the string every other assertion looked for. Every test passed.
   *
   * Asserting `toContain(".tf-native {")` cannot see this: the rule really does
   * contain that text. It takes reading the selector list *up to the brace*, which
   * is what `selectorsOf` does. This is the general lesson — a presence check on
   * a stylesheet tests that a fragment appears somewhere, not that the rule means
   * what its comment says it means.
   */
  it("lists nothing but the marker in the rule's selector, so no bare element rides along", () => {
    const selectors = selectorsOf(`.${NATIVE_FIELD_CLASS}`);
    expect(selectors).toEqual([`.${NATIVE_FIELD_CLASS}`]);
  });

  it("paints no bare form element anywhere in the file", () => {
    /*
     * The general shape of the same defect, one level up: a rule that selects a
     * bare `input`, `select`, `textarea` or `button` and paints it. Fluent
     * components render exactly those elements, so such a rule reaches into
     * components we do not own.
     *
     * Scoped to rules that actually declare a colour, because a bare element is
     * not the problem by itself: `input:focus-visible` sets an outline and is
     * correct and desirable on every input, Fluent's included. What must not
     * happen is a bare element being handed a background or a text colour.
     *
     * Fluent v8 ships class-based rules (`.ms-Button`, `.ms-TextField-input`),
     * which outrank a bare-element selector, so today such a rule would lose on
     * specificity rather than by intent — the same accidental safety the old
     * `:not([class*="ms-"])` deny-list relied on, and one that inverts the moment
     * load order changes. Asserting the shape keeps us off that dependency.
     */
    const painted = colourBearingRules(selectorsOnly())
      .flatMap((rule) => rule.selectors)
      .filter((selector) => BARE_FORM_ELEMENT.test(selector));
    expect(painted).toEqual([]);
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

describe("every button we render", () => {
  /*
   * The button half of the same defect, found by auditing rather than by the
   * audit. Eighty buttons in the task pane were styled by bare `button`
   * selectors, and Fluent's `DefaultButton`, `PrimaryButton`, `IconButton` and
   * `Toggle` all render a `<button>` too — so those rules reached into components
   * this codebase does not own.
   *
   * They were losing on specificity against Fluent's own class-based rules, so
   * nothing looked wrong. Losing by accident is not a design, and it inverts the
   * moment the stylesheet load order changes. So the buttons carry their own
   * marker, exactly as the fields do.
   */
  it("carries the button marker, so it cannot fall outside the scoped rules", () => {
    /*
     * Accepts either spelling of "marked": the class written out, or the
     * `nativeButtonProps` helper that emits it. A control using the helper is
     * marked by construction and cannot drift; one that writes the literal can,
     * which is why both are allowed here and the helper is preferred at the call
     * site. Rejecting the helper would push every future control back to the
     * literal, which is the thing most likely to be misspelled.
     */
    const unmarked = buttons().filter(
      (control) =>
        !control.source.includes(NATIVE_BUTTON_CLASS) &&
        !control.source.includes("nativeButtonProps"),
    );
    expect(
      unmarked.map(
        (control) => `${control.file} #${control.index}: ${control.source.slice(0, 60)}`,
      ),
    ).toEqual([]);
  });

  it("is more than a token few, so the button rule is actually load-bearing", () => {
    expect(buttons().length).toBeGreaterThan(50);
  });

  it("keeps the control's own class beside the marker rather than replacing it", () => {
    /*
     * A marker written over the existing className would silently strip the
     * styling the control already depended on — `tf-link-button` and
     * `tf-collapsible-header` both carry meaning. This asserts the marker is
     * additive, which is the part a "does every button carry the marker" check
     * cannot see: it would pass just as happily on a className the marker had
     * eaten.
     */
    const surviving = new Set(
      buttons()
        .map((control) => control.source.match(/className="([^"]*)"/))
        .filter((match): match is RegExpMatchArray => match !== null)
        .flatMap((match) => (match[1] ?? "").split(/\s+/).filter((token) => token.length > 0)),
    );
    // Classes that predate the marker and are still in use.
    ["tf-link-button", "tf-collapsible-header", "tf-coverage-action"].forEach((existing) => {
      expect(surviving.has(existing)).toBe(true);
    });
  });

  it("keeps the two markers distinct, so a field and a button are not styled alike", () => {
    // One class for both would force a button to be painted as a surface or a
    // field to be painted as a control. They are different things.
    expect(NATIVE_BUTTON_CLASS).not.toBe(NATIVE_FIELD_CLASS);
  });
});

describe("the marker itself", () => {
  it("is a ToneForge-owned class, not a Fluent one", () => {
    // If this ever starts with `ms-`, the rule has become a guess about another
    // library's naming again — the defect this replaced.
    expect(NATIVE_FIELD_CLASS.startsWith("tf-")).toBe(true);
    expect(NATIVE_FIELD_CLASS).not.toContain("ms-");
    expect(NATIVE_BUTTON_CLASS.startsWith("tf-")).toBe(true);
    expect(NATIVE_BUTTON_CLASS).not.toContain("ms-");
  });

  it("is distinct from the wrapper class, which is already on the labels", () => {
    // `tf-field` is on the <label> wrappers. Reusing it would put one class on
    // two elements for two unrelated reasons.
    expect(NATIVE_FIELD_CLASS).not.toBe("tf-field");
    expect(NATIVE_BUTTON_CLASS).not.toBe("tf-field");
  });
});
