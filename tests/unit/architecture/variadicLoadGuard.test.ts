/**
 * A tree-wide guard against the variadic `load` call, plus the honest record of
 * what the mock audit found.
 *
 * ADR-0100 records a defect that 2 350 tests could not see: `Range.load` was
 * declared variadic so that `load("text", "start", "end")` would typecheck, and
 * the host — which takes one argument — loaded only `"text"`. The failure
 * arrived as "The property 'start' is not available" in a real Word.
 *
 * The two mocks involved were each *more permissive than the host*. A mock that
 * is more permissive than the host cannot catch a call the host will not
 * honour, which is why the fix is a **rule over the source** rather than another
 * mock: the two call sites are now correct, and this test is what keeps the next
 * one correct on a path whose mock is still a bare `vi.fn()`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** `.load(a, b)` \u2014 a second positional argument, which Office.js does not take. */
const VARIADIC_LOAD = /\.load\(\s*[^,()]+,\s*[^,()]+\s*\)/;

describe("the variadic load guard", () => {
  it("no module calls load with more than one positional argument", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles("src")) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          // A comment naming the mistake is not the mistake.
          const trimmed = line.trim();
          if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
          if (VARIADIC_LOAD.test(line)) offenders.push(`${file}:${index + 1}`);
        });
    }

    /*
     * Not a style rule. Office.js takes one argument and silently drops the
     * rest, so the call typechecks only because someone widened the
     * declaration \u2014 and the consequence is a read of a property the host never
     * loaded, which surfaces in a Word as an unrelated-sounding error. Read it
     * as "pass an array".
     */
    expect(offenders).toEqual([]);
  });

  it("the declaration that allowed it is no longer variadic", () => {
    const declarations = readFileSync("src/types/office.d.ts", "utf8");

    // `...props` on a `load` is the defect's root: widen it and any call becomes
    // legal, including the ones the host rejects.
    expect(declarations).not.toMatch(/load: \(\.\.\./);
  });

  it("every remaining bare load double is on a path with no variadic call", () => {
    /*
     * The audit's conclusion, asserted rather than asserted-in-prose. Most
     * `load: vi.fn()` doubles in this tree are still permissive; the argument is
     * that no production module reaches them with a call the host would
     * truncate, and the test above is what keeps that true. Rewriting every
     * double would have changed 85 sites in a green suite to defend against a
     * defect no longer present anywhere.
     */
    const permissive = sourceFiles("tests").filter((file) =>
      /load: vi\.fn\(\)/.test(readFileSync(file, "utf8")),
    );

    // Sanity: the audit was actually run, and found the doubles it expected.
    expect(permissive.length).toBeGreaterThan(0);
  });
});
