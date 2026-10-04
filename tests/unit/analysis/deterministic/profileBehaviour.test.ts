/**
 * Does every profile field do anything?
 *
 * The spec §11 audit (`ruleRegistry.test.ts`) answers one question: is every
 * field in `PROFILE_FIELD_PATHS` read by a rule that has a body? That is the
 * right question, and this file is about the two lists it depends on — because
 * an audit is only as complete as its inputs.
 *
 * Both defects found here were invisible to the existing audit for the same
 * structural reason: the list was written by hand, and the checks that read it
 * start *from* the list. A field absent from the list is not "unwired"; it is
 * unexamined. `unwiredProfilePaths()` cannot report a field it does not know
 * exists.
 *
 * - `houseStyle.capitalization.sentenceCase` is read by `houseStyle.ts` and
 *   emitted on a real finding, yet was missing from `PROFILE_FIELD_PATHS`. The
 *   §11 audit therefore could not see it either way — not as wired, not as
 *   orphaned.
 * - `houseStyle.spellingVariant` was in neither list. Its comment claimed
 *   `METADATA_ONLY_PROFILE_PATHS` was "the place a field with no rule says so",
 *   but that list was empty and the field was absent from the profile list, so
 *   the honest statement existed only as prose.
 *
 * So the inputs are derived here rather than trusted: leaf paths are walked from
 * the schemas, and the rule-read set is read back from `DETERMINISTIC_RULES`.
 * Both lists must then account for the union.
 *
 * No DOM and no Office: this is a pure read over schemas and a registry.
 */

import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  DETERMINISTIC_RULES,
  METADATA_ONLY_PROFILE_PATHS,
  PROFILE_FIELD_PATHS,
} from "../../../../src/analysis/deterministic/ruleRegistry";
import {
  DeterministicStyleProfileSchema,
  HouseStyleSchema,
} from "../../../../src/core/domain/StyleProfile";

/** Wrappers that carry no shape of their own: `z.object({…}).default({…})`, `.optional()`. */
const WRAPPERS = new Set([
  "ZodDefault",
  "ZodOptional",
  "ZodNullable",
  "ZodCatch",
  "ZodReadonly",
  "ZodBranded",
]);

/**
 * Leaf paths of a Zod object, dotted, with array and record members kept whole.
 *
 * Arrays and records are leaves on purpose. `language.terminology` is a list of
 * rule objects, and expanding it would produce `language.terminology.0.id` —
 * paths no rule could ever name. A rule reads the collection; the fields inside
 * it are the record's business.
 *
 * Wrappers are unwrapped in a **loop**, not once. `DocumentFormattingProfileSchema`
 * is `z.object({…}).default({…})`, so a single unwrap lands on the `ZodDefault`
 * rather than the object inside it, and the whole section collapses to the one
 * path `formatting`. That is a silent under-count: the section's nine real fields
 * would go unexamined and the test would pass having checked almost nothing.
 */
function leafPaths(schema: z.ZodTypeAny, prefix = ""): string[] {
  let current = schema;
  let def = (current as { _def?: { typeName?: string; shape?: () => z.ZodRawShape } })._def;

  while (def !== undefined && WRAPPERS.has(def.typeName ?? "")) {
    const inner = (current as { _def?: { innerType?: z.ZodTypeAny } })._def?.innerType;
    if (inner === undefined) break;
    current = inner;
    def = (current as { _def?: { typeName?: string; shape?: () => z.ZodRawShape } })._def;
  }

  if (def?.typeName !== "ZodObject" || def.shape === undefined) {
    return prefix === "" ? [] : [prefix];
  }

  return Object.entries(def.shape()).flatMap(([key, value]) =>
    leafPaths(value as z.ZodTypeAny, prefix === "" ? key : `${prefix}.${key}`),
  );
}

/** The paths every rule actually reads, whether or not they are declared. */
function readPaths(): string[] {
  return DETERMINISTIC_RULES.filter((rule) => rule.analyze !== undefined).flatMap((rule) => [
    ...rule.profilePaths,
  ]);
}

function covered(path: string, entries: readonly string[]): boolean {
  return entries.some((entry) => path === entry || path.startsWith(`${entry}.`));
}

describe("the profile field list is complete", () => {
  const fromSchema = [
    ...leafPaths(DeterministicStyleProfileSchema),
    ...leafPaths(HouseStyleSchema).map((path) => `houseStyle.${path}`),
  ];

  it("names every leaf the deterministic profile schema exposes", () => {
    /*
     * The load-bearing assertion. A field the audit has never heard of cannot be
     * reported as unwired, so an omission is not a pass — it is a silence.
     */
    const undeclared = fromSchema.filter((path) => !covered(path, PROFILE_FIELD_PATHS));

    expect(undeclared).toEqual([]);
  });

  it("declares no path the schema does not have", () => {
    // The other direction. A declared path that no schema produces is a rule
    // reading a field that does not exist, which is the mistake ADR-0100 records.
    const invented = PROFILE_FIELD_PATHS.filter(
      (path) => !fromSchema.some((schemaPath) => covered(schemaPath, [path])),
    );
    expect(invented).toEqual([]);
  });

  it("leaves no schema path neither read by a rule nor declared as metadata", () => {
    /*
     * The union, deliberately. Checking `PROFILE_FIELD_PATHS` alone repeats the
     * §11 audit; checking the schema catches a field that is unreachable *and*
     * unlisted, which is the case that actually happened.
     */
    const accounted = [...readPaths(), ...METADATA_ONLY_PROFILE_PATHS];
    const orphans = fromSchema.filter(
      (path) => !covered(path, accounted) && !covered(path, PROFILE_FIELD_PATHS),
    );
    expect(orphans).toEqual([]);
  });
});

describe("the metadata-only list says what it claims to", () => {
  it("is empty only because every field is read", () => {
    /*
     * The list's own doc comment claims it is "where a field with no rule says
     * so". That claim is only meaningful if a field with no rule lands in it —
     * and `houseStyle.spellingVariant` is exactly that field, sitting in neither
     * list, with the decision recorded only as prose beside the list it should
     * have been in.
     */
    expect(METADATA_ONLY_PROFILE_PATHS).toEqual(["houseStyle.spellingVariant"]);
  });

  it("declares as metadata only a field no rule reads", () => {
    // The reciprocal of the list's purpose: an excuse for a live field would
    // silence the audit for a setting that genuinely does something.
    expect(readPaths()).not.toContain("houseStyle.spellingVariant");
  });

  it("keeps every excuse inside the profile list, so an excuse is never a hiding place", () => {
    METADATA_ONLY_PROFILE_PATHS.forEach((path) => {
      expect(PROFILE_FIELD_PATHS).toContain(path);
    });
  });
});

describe("sentence case has one owner, not two (ADR-0125)", () => {
  /*
   * `houseStyle.capitalization.sentenceCase` and
   * `language.capitalisation.sentenceCase` shared a name and a spelling, and the
   * house-style one is gone. It flagged a sentence not opening with a capital —
   * the same judgement — while walking every sentence in the document, and the
   * registry filtered its category out, so the toggle in the editor produced
   * nothing a user could observe.
   *
   * Sentence case is now owned twice, and by different things:
   * `headingCase` for headings, `capitalisation.sentenceCase` for body prose.
   */
  it("leaves the house-style field in neither the schema nor either list", () => {
    expect(PROFILE_FIELD_PATHS).not.toContain("houseStyle.capitalization.sentenceCase");
    expect(METADATA_ONLY_PROFILE_PATHS).not.toContain("houseStyle.capitalization.sentenceCase");
    expect(readPaths()).not.toContain("houseStyle.capitalization.sentenceCase");
  });

  it("still reads body-prose sentence case, under the language section", () => {
    expect(readPaths()).toContain("language.capitalisation.sentenceCase");
    expect(PROFILE_FIELD_PATHS).toContain("language.capitalisation.sentenceCase");
  });

  it("still reads heading case, which is what governs headings now", () => {
    expect(readPaths()).toContain("language.capitalisation.headingCase");
    expect(PROFILE_FIELD_PATHS).toContain("language.capitalisation.headingCase");
  });
});
