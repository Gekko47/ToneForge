/**
 * Semantic Style V2: the persisted schema, and the V1 -> V2 upgrade on read.
 *
 * The round trip is the load-bearing claim — "nothing is silently discarded" —
 * and it is asserted field by field rather than by snapshot comparison, because a
 * snapshot assertion passes just as happily when a value has moved to the wrong
 * place as when it has been lost.
 */

import { describe, expect, it } from "vitest";

import {
  createEmptySemanticStyleProfile,
  isDefaultSemanticStyle,
  migrateSemanticStyleFromV1,
  RHETORICAL_STYLE_VALUES,
  SEMANTIC_DIMENSIONS,
  SEMANTIC_STYLE_SCHEMA_VERSION,
  SemanticStyleProfileSchema,
  StoredSemanticStyleSchema,
  v1EditorialPins,
  type LegacySemanticProfileV1,
} from "../../../../src/core/domain/SemanticStyleProfile";
import {
  EditorialPolicySchema,
  StoredEditorialPolicySchema,
} from "../../../../src/core/domain/GovernanceProfile";
import { StyleProfileSchema } from "../../../../src/core/domain/StyleProfile";

const V1: LegacySemanticProfileV1 = {
  tone: "measured, forensic",
  voice: "impasional",
  formality: 72,
  readingGradeTarget: 14,
  preferredSentenceLength: 31,
  vocabularyRegister: "technical",
  rhetoricalStyle: "forensic",
  avoidWords: ["utilise", "leverage"],
};

describe("SemanticStyleProfileSchema", () => {
  it("stamps its own version on a parsed profile", () => {
    expect(createEmptySemanticStyleProfile().schemaVersion).toBe(SEMANTIC_STYLE_SCHEMA_VERSION);
  });

  it("fills every dimension from an empty object", () => {
    // Every field defaults because this is the persisted shape: a stored record
    // has to tolerate absence. That is also why it must never be used to
    // validate a model's answer — see `semanticStyleExtraction.ts` in P2.
    const profile = SemanticStyleProfileSchema.parse({});
    SEMANTIC_DIMENSIONS.forEach((dimension) => {
      expect(profile[dimension]).toBeDefined();
    });
    expect(isDefaultSemanticStyle(profile)).toBe(true);
  });

  it("names sixteen dimensions, and the schema has exactly those fields", () => {
    // A dimension in the schema and not in this list is one no surface can
    // render, and a name in the list and not in the schema is one that would
    // throw on access. The two lists are one contract, so they are checked
    // against each other rather than trusted.
    expect(SEMANTIC_DIMENSIONS).toHaveLength(16);
    const shape = SemanticStyleProfileSchema.shape as Record<string, unknown>;
    SEMANTIC_DIMENSIONS.forEach((dimension) => {
      expect(Object.keys(shape)).toContain(dimension);
    });
  });

  it("refuses a third tone, because a profile that cannot choose is not a profile", () => {
    const tooMany = SemanticStyleProfileSchema.safeParse({
      tone: { primary: "neutral", secondary: ["assertive", "cautious", "forensic"] },
    });
    expect(tooMany.success).toBe(false);
  });

  it("bounds the free-text fields, which are the leak surface", () => {
    const long = SemanticStyleProfileSchema.safeParse({
      tone: { description: "x".repeat(241) },
      notes: Array.from({ length: 21 }, () => "note"),
    });
    expect(long.success).toBe(false);
  });

  it("carries no legacy block on a profile that never had one", () => {
    // Optional rather than defaulted, so "nothing was carried" stays
    // distinguishable from "nothing needed carrying".
    expect(createEmptySemanticStyleProfile().legacyV1).toBeUndefined();
  });
});

describe("migrateSemanticStyleFromV1", () => {
  it("maps the six fields V2 has a home for", () => {
    const migrated = migrateSemanticStyleFromV1(V1);

    expect(migrated.formality.score).toBe(72);
    expect(migrated.register.primary).toBe("technical");
    expect(migrated.sentenceArchitecture.targetWords).toBe(31);
    expect(migrated.rhetoricalStyle).toBe("forensic");
    expect(migrated.lexicalPreferences.toneAvoid).toEqual(["utilise", "leverage"]);
  });

  it("keeps the free strings as descriptions rather than guessing an enum value", () => {
    // "measured, forensic" is not a tone trait, and mapping it to the nearest one
    // would be an invented claim about an author's voice.
    const migrated = migrateSemanticStyleFromV1(V1);
    expect(migrated.tone.primary).toBe("neutral");
    expect(migrated.tone.description).toBe("measured, forensic");
    expect(migrated.voice.description).toBe("impasional");
  });

  it("carries the three values V2 cannot express instead of dropping them", () => {
    const migrated = migrateSemanticStyleFromV1(V1);
    expect(migrated.legacyV1).toEqual({
      readingGradeTarget: 14,
      vocabularyRegister: "technical",
      tone: "measured, forensic",
      voice: "impasional",
      rhetoricalStyle: "forensic",
    });
  });

  it("loses nothing: every V1 field is either mapped or carried", () => {
    const migrated = migrateSemanticStyleFromV1(V1);
    const accountedFor = new Set<string>();
    if (migrated.formality.score === V1.formality) accountedFor.add("formality");
    if (migrated.lexicalPreferences.toneAvoid.join() === V1.avoidWords.join())
      accountedFor.add("avoidWords");
    if (migrated.sentenceArchitecture.targetWords === V1.preferredSentenceLength)
      accountedFor.add("preferredSentenceLength");
    if (migrated.register.primary === "technical") accountedFor.add("vocabularyRegister");
    if (migrated.tone.description === V1.tone) accountedFor.add("tone");
    if (migrated.voice.description === V1.voice) accountedFor.add("voice");
    if (migrated.rhetoricalStyle === V1.rhetoricalStyle) accountedFor.add("rhetoricalStyle");
    if (migrated.legacyV1?.readingGradeTarget === V1.readingGradeTarget)
      accountedFor.add("readingGradeTarget");

    // Sorted on both sides. The claim is "every V1 field is accounted for", and
    // that is a statement about the set — an assertion that also pins the order
    // would fail on a change of sort collation rather than on a real loss.
    expect(Array.from(accountedFor).sort()).toEqual(
      [
        "avoidWords",
        "formality",
        "preferredSentenceLength",
        "readingGradeTarget",
        "rhetoricalStyle",
        "tone",
        "voice",
        "vocabularyRegister",
      ].sort(),
    );
  });

  it("maps each vocabulary register to its nearest V2 register", () => {
    // Four branches, four claims. Asserted as a table because a partial map is
    // exactly what would pass a single-case test: "standard -> professional" is
    // correct, and so is a mapping that quietly sent "academic" there too.
    const cases: ReadonlyArray<readonly [LegacySemanticProfileV1["vocabularyRegister"], string]> = [
      ["academic", "academic"],
      ["technical", "technical"],
      ["simple", "plain"],
      ["standard", "professional"],
    ];
    cases.forEach(([input, expected]) => {
      expect(
        migrateSemanticStyleFromV1({ ...V1, vocabularyRegister: input }).register.primary,
      ).toBe(expected);
    });
  });

  it("maps only the rhetorical styles V2 can name", () => {
    // "direct" has no V2 value, so it becomes the default rather than a guess.
    // A stored "flowery" likewise does not become "narrative".
    expect(migrateSemanticStyleFromV1({ ...V1, rhetoricalStyle: "direct" }).rhetoricalStyle).toBe(
      "direct-analytical",
    );
    expect(
      migrateSemanticStyleFromV1({ ...V1, rhetoricalStyle: "narrative" }).rhetoricalStyle,
    ).toBe("direct-analytical");
    expect(migrateSemanticStyleFromV1({ ...V1, rhetoricalStyle: "forensic" }).rhetoricalStyle).toBe(
      "forensic",
    );
  });

  it("reads an absent or nullish block as an all-default profile with nothing carried", () => {
    const migrated = migrateSemanticStyleFromV1(undefined);
    expect(migrated.legacyV1).toBeDefined();
    expect(migrated.tone.description).toBe("");
    expect(migrated.lexicalPreferences.toneAvoid).toEqual([]);
  });

  it("is idempotent through the stored schema: a migrated block survives a round trip", () => {
    const once = migrateSemanticStyleFromV1(V1);
    const twice = StoredSemanticStyleSchema.parse(once);
    expect(twice).toEqual(once);
  });
});

describe("StoredSemanticStyleSchema", () => {
  it("reads a V1 block as V2 without the caller doing anything", () => {
    const stored = StoredSemanticStyleSchema.parse(V1);
    expect(stored.tone.description).toBe("measured, forensic");
    expect(stored.schemaVersion).toBe(SEMANTIC_STYLE_SCHEMA_VERSION);
  });

  it("passes a V2 block through untouched", () => {
    const v2 = createEmptySemanticStyleProfile();
    expect(StoredSemanticStyleSchema.parse(v2)).toEqual(v2);
  });

  it("upgrades a v10 store's block on the way to the current state", () => {
    // The point of putting the upgrade in the schema rather than in one
    // migration step: every migration step funnels through `readCurrentState`, so
    // a v7 store's profile is upgraded by exactly the same code as a v13 store's.
    const now = "2026-01-01T00:00:00.000Z";
    const profile = StyleProfileSchema.parse({
      id: "3f1b0c6e-6a54-4b1e-9c2a-0d1e2f3a4b5c",
      name: "House",
      revision: 1,
      measured: {},
      semantic: V1,
      typography: {},
      houseStyle: {},
      createdAt: now,
      updatedAt: now,
      sourceSampleIds: [],
    });
    expect(profile.semantic.formality.score).toBe(72);
    expect(profile.semantic.tone.description).toBe("measured, forensic");
  });
});

describe("StoredEditorialPolicySchema", () => {
  it("maps a V1 editorial block and pins the dimensions it governed", () => {
    const stored = StoredEditorialPolicySchema.parse({
      tone: "formal",
      formality: 60,
      preferredSentenceLength: 28,
      avoidWords: ["utilise"],
    });

    expect(stored.tone).toEqual({ description: "formal" });
    expect(stored.formality).toEqual({ score: 60 });
    expect(stored.sentenceArchitecture).toEqual({ targetWords: 28 });
    expect(stored.lexicalPreferences).toEqual({ toneAvoid: ["utilise"] });
    // V1's rule was "non-default", and `explicitFields` did not exist, so the
    // pins are recomputed rather than carried. A migrated policy governs exactly
    // what it governed before and not one dimension more.
    expect(stored.explicitFields).toEqual([
      "tone",
      "formality",
      "sentenceArchitecture",
      "lexicalPreferences",
    ]);
  });

  it("drops a rhetorical style V2 has no value for rather than guessing one", () => {
    const stored = StoredEditorialPolicySchema.parse({ rhetoricalStyle: "flowery" });
    expect(RHETORICAL_STYLE_VALUES.has("flowery")).toBe(false);
    expect(stored.rhetoricalStyle).toBeUndefined();
    expect(v1EditorialPins({ rhetoricalStyle: "flowery" })).toContain("rhetoricalStyle");
  });

  it("keeps a rhetorical style that is already a V2 value", () => {
    const stored = StoredEditorialPolicySchema.parse({ rhetoricalStyle: "forensic" });
    expect(stored.rhetoricalStyle).toBe("forensic");
    expect(stored.explicitFields).toEqual(["rhetoricalStyle"]);
  });

  it("leaves a V2 policy with no pins alone", () => {
    const authored = EditorialPolicySchema.parse({
      tone: { primary: "assertive" },
      explicitFields: ["tone"],
    });
    expect(StoredEditorialPolicySchema.parse(authored)).toEqual(authored);
  });

  it("pins nothing for a V1 block holding only defaults", () => {
    // The legacy rule was "a value counts as pinned when it differs from the
    // default", so an all-default V1 block governed nothing and must not be
    // promoted into a policy that governs everything.
    expect(v1EditorialPins({})).toEqual([]);
    expect(
      StoredEditorialPolicySchema.parse({
        tone: "neutral",
        formality: 50,
        avoidWords: [],
        preferredSentenceLength: 22,
      }).explicitFields,
    ).toEqual([]);
  });
});
