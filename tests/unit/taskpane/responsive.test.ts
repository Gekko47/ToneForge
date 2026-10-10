/**
 * Responsive behaviour is a layout property, and jsdom computes no layout.
 *
 * The plan's P11 gate is "no horizontal scrollbar in a normal workflow" (spec
 * §33, criterion 18). A test cannot measure a scrollbar, but it can assert the
 * one structural cause of one: a `space-between` flex row whose two ends cannot
 * wrap. At 320px the pane is routinely docked narrow, and a row that keeps its
 * ends on one line pushes the wider end past the pane edge — which is exactly
 * the horizontal scroll the gate forbids.
 *
 * So the guard is the invariant, not the pixel: every `justifyContent:
 * "space-between"` style block in the pane must also declare `flexWrap: "wrap"`.
 * The primitives that already wrap (CoverageSummary, ProfileIndicator,
 * StickyActionBar, Section, PageHeader) pass unchanged; the Home rows and
 * MetadataRow were given `flexWrap` in P11 to satisfy it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
const TASKPANE = join(ROOT, "src", "taskpane");

/** Every .tsx under src/taskpane, recursively. */
function tsxFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

/** Strips comments so a doc naming the pattern is not read as the pattern. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Parse TypeScript source and extract all style object literals that contain
 * `justifyContent: "space-between"`. Uses the TypeScript AST so nested
 * makeStyles rules and inline style objects with template expressions are
 * handled correctly — a naive brace-matching regex would miss those.
 */
function spaceBetweenBlocks(source: string): string[] {
  const results: string[] = [];
  const sf = ts.createSourceFile("test.tsx", source, ts.ScriptTarget.Latest, true);

  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      const propName = node.name.text;
      if (propName === "justifyContent") {
        // Walk up to find the enclosing style object
        const parent = node.parent;
        if (parent && ts.isObjectLiteralExpression(parent)) {
          // Check if this object has flexWrap
          const hasFlexWrap = parent.properties.some(
            (p) =>
              ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "flexWrap",
          );
          if (!hasFlexWrap) {
            results.push(parent.getText(sf));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return results;
}

describe("responsive layout in the task pane", () => {
  it("wraps every space-between flex row, so neither end can overflow the pane", () => {
    const offenders = tsxFiles(TASKPANE).flatMap((file) => {
      const source = withoutComments(readFileSync(file, "utf8"));
      return spaceBetweenBlocks(source).map(() => file.replace(/\\/g, "/"));
    });

    // Read back as an array so a failure names the files rather than a count.
    expect(offenders).toEqual([]);
  });
});
