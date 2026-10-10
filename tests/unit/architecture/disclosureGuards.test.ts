/**
 * Guard tests for the disclosure-panel unification (plan §11.4, ADR-0123).
 *
 * These scan the source tree at runtime rather than importing components, so
 * they catch a regression wherever it is introduced: a stray details element or
 * a revived class name fails here even if no component test renders the file.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TASKPANE_DIR = path.resolve(__dirname, "../../../src/taskpane");
const TASKPANE_CSS = path.resolve(TASKPANE_DIR, "taskpane.css");

/** All .tsx files under src/taskpane, recursively. */
function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/** Strip line and block comments so prose is not mistaken for code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const RETIRED_CLASS_NAMES = [
  "tf-finding-detail-region",
  "tf-disclosure",
  "tf-collapsible",
  "tf-expand",
] as const;

describe("no <details> or <summary> in taskpane tsx", () => {
  const files = tsxFiles(TASKPANE_DIR);

  it("finds at least one tsx file to scan, so the guard is not vacuous", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("has no <details> or <summary> element in any taskpane tsx file", () => {
    files.forEach((file) => {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      expect(code, file).not.toMatch(/<details[\s>]/i);
      expect(code, file).not.toMatch(/<summary[\s>]/i);
    });
  });
});

describe("no retired class names in src tsx or taskpane.css", () => {
  const tsxContents = tsxFiles(TASKPANE_DIR).map((file) =>
    stripComments(fs.readFileSync(file, "utf8")),
  );
  const cssContents = fs.existsSync(TASKPANE_CSS) ? fs.readFileSync(TASKPANE_CSS, "utf8") : "";

  it("has no retired class names in any taskpane tsx file", () => {
    RETIRED_CLASS_NAMES.forEach((cls) => {
      tsxContents.forEach((code) => {
        expect(code, cls).not.toContain(cls);
      });
    });
  });

  it("has no retired class names in taskpane.css", () => {
    RETIRED_CLASS_NAMES.forEach((cls) => {
      expect(cssContents, cls).not.toContain(cls);
    });
  });
});
