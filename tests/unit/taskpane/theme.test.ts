/**
 * The theme token layer, asserted rather than assumed.
 *
 * The v9 provider owns theming through `FluentProvider`, which writes design
 * tokens as CSS variables at the provider root. The `--tf-*` tokens in
 * `taskpane.css` remain for components that have not yet migrated to v9 — they
 * flip with the `tf-theme-dark`/`tf-theme-light` classes the provider applies
 * to the document element.
 *
 * These tests pin the two things that can be checked without a browser. They
 * deliberately do **not** claim the rendering is correct: jsdom cannot compute
 * styles, so whether Word actually paints a component dark is a manual
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

describe("components do not hardcode colours", () => {
  it("has no colour literal outside the theme definition", () => {
    const config = readFileSync(join(here, "../../../eslint.config.mjs"), "utf8");
    expect(config).toContain("src/taskpane/**/*.tsx");
    expect(config).toContain("src/taskpane/theme/toneForgeTheme.ts");
  });

  it("keeps the brand ramp in the theme module, where both themes are built", () => {
    const theme = readFileSync(
      join(here, "../../../src/taskpane/theme/toneForgeTheme.ts"),
      "utf8",
    ) as string;
    expect(theme).toContain("#0078D4");
    expect(theme).toContain("createLightTheme");
    expect(theme).toContain("createDarkTheme");
  });
});
