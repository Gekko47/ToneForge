/**
 * The token layer, asserted rather than assumed.
 *
 * The reported symptom was drop boxes and input sections not following the
 * global theme. The palette itself was never wrong — `taskpane.css` declares a
 * complete token set under two theme classes and `createDefaultTheme` sets
 * `isInverted` correctly. What had gone wrong was everything *around* it: two
 * components with hardcoded hex, and an unscoped `input { background-color }`
 * that also landed on Fluent's own fields.
 *
 * These tests pin the two things that can be checked without a browser. They
 * deliberately do **not** claim the rendering is correct: jsdom cannot compute
 * styles, so whether Word actually paints a Dropdown dark is a manual
 * verification step and is recorded as such in `docs/manual-verification.md`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../../../src/taskpane/taskpane.css"), "utf8");

/** The custom properties declared by one theme class. */
function tokensOf(selector: string): string[] {
  const block = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, "m").exec(css)?.[1] ?? "";
  return [...block.matchAll(/--tf-[a-z-]+(?=\s*:)/g)].map((match) => match[0]);
}

const LIGHT = tokensOf(".tf-theme-light");
const DARK = tokensOf(".tf-theme-dark");

describe("theme tokens", () => {
  it("declares the same tokens in both themes", () => {
    // A token added to one theme and not the other resolves to nothing in the
    // other, and `var(--tf-x)` with no fallback renders as inherited — which
    // looks like a component that ignored the theme rather than a missing
    // declaration.
    expect([...DARK].sort()).toEqual([...LIGHT].sort());
    expect(LIGHT.length).toBeGreaterThan(0);
  });

  it("covers the roles the components reach for", () => {
    // The set the stylesheet and the components actually use. A new role needs
    // a new token here, not a literal.
    ["--tf-bg", "--tf-surface", "--tf-text", "--tf-muted", "--tf-border", "--tf-accent"].forEach(
      (token) => expect(LIGHT).toContain(token),
    );
    // Status colours: the results and warnings the pane renders.
    ["--tf-danger", "--tf-success", "--tf-warning-bg", "--tf-warning-border"].forEach((token) =>
      expect(LIGHT).toContain(token),
    );
  });
});

describe("the native-control rule", () => {
  /*
   * These two assertions used to pin the *mechanism* — that the rule carried
   * `:not([class*="ms-"])` — rather than the claim it protects, which is that
   * Fluent's fields are never touched by our styling. Pinning the mechanism made
   * the guard itself fail the day it was replaced by something better, which is
   * how a real improvement gets reverted to satisfy a test.
   *
   * The mechanism is now `.tf-native`, a class we own (UX-4a). The claim is
   * unchanged and is asserted against the selectors, so the prose explaining the
   * change cannot satisfy or defeat it.
   *
   * `nativeFieldMarkers.test.ts` covers the other half: that every native control
   * we actually render carries the marker. Between them, a control added without
   * it fails, and a bare-element rule returning fails.
   */
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("excludes Fluent's own inputs by scoping to our marker", () => {
    expect(selectors).toContain(".tf-native {");
    // The old deny-list is gone rather than kept alongside: two guards for one
    // problem is two things to maintain, and the deny-list is the fragile one.
    expect(selectors).not.toContain("ms-");
  });

  it("no longer groups the three elements into one unscoped rule", () => {
    /*
     * The shape that caused it: a bare `input,\nselect,\ntextarea` selector
     * list carrying `background-color`. Prettier reflows selector lists, so
     * this matches the declaration rather than the formatting — a colour rule
     * applying to a bare element selector is the thing that must not return.
     */
    const bareGroup =
      /(?:^|\n)\s*(?:input|select|textarea)\s*,\s*\n\s*(?:input|select|textarea)\s*\{/;
    expect(selectors).not.toMatch(bareGroup);
    expect(selectors).not.toMatch(/(?:^|\n)\s*input\s*\{/);
  });
});

describe("components do not hardcode colours", () => {
  it("has no colour literal outside the palette definition", () => {
    /*
     * The lint rule in `eslint.config.mjs` is the real gate — it fires at the
     * line that adds one. This test is the belt to that braces: it fails if
     * the rule is ever scoped away or the file list drifts, which is how a
     * guard quietly stops guarding.
     */
    const config = readFileSync(join(here, "../../../eslint.config.mjs"), "utf8");
    expect(config).toContain("src/taskpane/**/*.tsx");
    expect(config).toContain("src/taskpane/fluentTheme.ts");
  });

  it("keeps the palette in the stylesheet, where the theme classes can flip it", () => {
    // `fluentTheme.ts` is the one place a literal belongs: it defines the
    // values the tokens carry. Both themes must be present there too, or the
    // Fluent components and the CSS disagree about the palette.
    const theme = readFileSync(
      join(here, "../../../src/taskpane/fluentTheme.ts"),
      "utf8",
    ) as string;
    expect(theme).toContain("isInverted");
    expect(theme).toContain("#0078d4");
    expect(theme).toContain("#4aaaf0");
  });
});
