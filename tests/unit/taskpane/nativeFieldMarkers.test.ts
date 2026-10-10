/**
 * The native-control marker is gone (P5).
 *
 * Every native `<input>`, `<select>`, `<textarea>` and `<button>` in the task
 * pane has been migrated to Fluent v9 components. The `.tf-native` and
 * `.tf-native-button` markers, and the CSS rules scoped to them, are deleted.
 *
 * These tests assert the *absence* of the markers, so a future control added
 * as a native element cannot silently fall outside the Fluent design system.
 *
 * The one native control that remains is `<input type="file">` in
 * `LearnSemanticStyle.tsx` — Fluent v9 has no file-picker component. It carries
 * no marker because the marker system is deleted; the browser default is the
 * correct rendering for a file control.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src", "taskpane");
const STYLESHEET = join(ROOT, "taskpane.css");

function readStylesheet(): string {
  return readFileSync(STYLESHEET, "utf8");
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith(".tsx") ? [full] : [];
  });
}

/** Source text with comments stripped, so prose mentioning a tag is not a tag. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Every `<tag>` of the given names the task pane renders, as source text. */
function tagsOf(name: string): Array<{ file: string; index: number; source: string }> {
  return tsxFiles(ROOT).flatMap((file) => {
    const src = codeOf(file);
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

describe("the native-control marker is gone", () => {
  it("no .tf-native class appears in any tsx file", () => {
    const marked = tsxFiles(ROOT).filter((file) => codeOf(file).includes("tf-native"));
    expect(marked).toEqual([]);
  });

  it("no .tf-native-button class appears in any tsx file", () => {
    const marked = tsxFiles(ROOT).filter((file) => codeOf(file).includes("tf-native-button"));
    expect(marked).toEqual([]);
  });

  it("no .tf-native rule remains in the stylesheet", () => {
    const css = readStylesheet();
    expect(css).not.toContain(".tf-native");
    expect(css).not.toContain("tf-native-button");
  });

  it("the focus-visible rule remains, unscoped", () => {
    const css = readStylesheet();
    expect(css).toContain("button:focus-visible");
    expect(css).toContain("outline: 2px solid var(--tf-accent)");
  });
});

describe("high-contrast support (spec §50 criterion 29)", () => {
  it("maps the residual --tf-* surfaces to system colours under forced-colors", () => {
    const css = readStylesheet();
    // Fluent components honour forced-colors themselves; the hand-authored
    // `--tf-*` surfaces do not, so one block must redefine them to system
    // colours or the pane keeps its light/dark values in Windows High Contrast.
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("--tf-text: CanvasText");
    expect(css).toContain("--tf-accent: LinkText");
    expect(css).toContain("--tf-surface: Canvas");
  });
});

describe("native controls remaining", () => {
  it("only the file input in LearnSemanticStyle remains, and it is type=file", () => {
    const natives = nativeControls().filter((control) => !control.source.includes('type="file"'));
    expect(
      natives.map((control) => `${control.file} #${control.index}: ${control.source.slice(0, 60)}`),
    ).toEqual([]);
  });

  it("no native button elements remain", () => {
    expect(buttons()).toEqual([]);
  });
});
