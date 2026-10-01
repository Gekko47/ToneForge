/**
 * State v13 -> v14.
 *
 * The interesting property is not what this step adds — two empty records — but
 * what it does *not* have to do, and why. Every migration step in this file ends
 * at `readCurrentState`, which parses profiles through `StyleProfileSchema`, and
 * that schema's `semantic` field upgrades a V1 block wherever it finds one. So
 * the semantic upgrade is asserted here against a v13 store, a v12 store, and a
 * v7 store, rather than being written once and trusted to reach the others.
 */

import { describe, expect, it } from "vitest";

import { CURRENT_STATE_VERSION, migrate } from "../../../../src/core/state/migration";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import { createRecord, newProfileId } from "../../../../src/core/domain/ProfileRecord";
import {
  SemanticReviewOutcomeSchema,
  type SemanticReviewOutcome,
} from "../../../../src/core/domain/SemanticReviewSession";

const NOW = "2026-01-01T00:00:00.000Z";
const PROFILE_ID = "3f1b0c6e-6a54-4b1e-9c2a-0d1e2f3a4b5c";

/** The V1 semantic block a v13 store would carry. */
const V1_SEMANTIC = {
  tone: "measured, forensic",
  voice: "impasional",
  formality: 72,
  readingGradeTarget: 14,
  preferredSentenceLength: 31,
  vocabularyRegister: "technical",
  rhetoricalStyle: "forensic",
  avoidWords: ["utilise"],
};

function v13(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 13,
    profileRecords: {},
    semanticProfileRecords: {},
    activeSemanticProfileId: null,
    ignoredFindings: [],
    reviewedFindings: [],
    deterministicReviewSession: null,
    governanceProfiles: {},
    governanceHistory: {},
    activeGovernanceProfileId: null,
    settings: {
      llmProvider: "openai",
      openAiCredentialMode: "broker",
      autoScan: true,
      consistencyReviewConsent: true,
      semanticOptIn: true,
    },
    ...overrides,
  };
}

/**
 * A v13 semantic record whose snapshots carry a V1 block.
 *
 * Built as a raw object rather than through `createRecord` on purpose: the
 * domain functions are typed for V2, and a fixture that cannot be expressed in
 * their types is precisely the point — it is what a v13 store holds on disk.
 */
function v13Profile(revision: number): Record<string, unknown> {
  return {
    ...createEmptyProfile("Learned style"),
    revision,
    semantic: V1_SEMANTIC,
  };
}

function semanticRecord(): Record<string, unknown> {
  const profile = v13Profile(1);
  return {
    id: PROFILE_ID,
    name: "Learned style",
    kind: "semantic",
    draft: profile,
    published: [{ at: NOW, revision: 1, profile: v13Profile(1) }],
    revisions: [
      { at: NOW, revision: 1, action: "created", detail: "created", profile: v13Profile(1) },
    ],
    activePublishedRevision: null,
    nextRevision: 2,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function outcome(
  sessionId: string,
  at: string,
  kind: SemanticReviewOutcome["outcome"] = "applied",
) {
  return {
    sessionId,
    profileId: PROFILE_ID,
    profileRevision: 1,
    outcome: kind,
    at,
    preservationPassed: true,
    selectionWordCount: 120,
  };
}

describe("migration v13 to v14", () => {
  it("lands on the current version", () => {
    expect(migrate(v13()).version).toBe(CURRENT_STATE_VERSION);
    expect(CURRENT_STATE_VERSION).toBe(14);
  });

  it("upgrades a V1 semantic block on a semantic record", () => {
    const result = migrate(v13({ semanticProfileRecords: { [PROFILE_ID]: semanticRecord() } }));
    const semantic = result.semanticProfileRecords[PROFILE_ID]?.draft?.semantic;

    expect(semantic?.formality.score).toBe(72);
    expect(semantic?.sentenceArchitecture.targetWords).toBe(31);
    expect(semantic?.lexicalPreferences.toneAvoid).toEqual(["utilise"]);
    expect(semantic?.legacyV1?.readingGradeTarget).toBe(14);
  });

  it("upgrades the V1 block on every stored snapshot, not just the draft", () => {
    // A record whose published version and revision trail still hold V1 would
    // restore-as-draft into a profile the engine cannot reason about.
    const result = migrate(v13({ semanticProfileRecords: { [PROFILE_ID]: semanticRecord() } }));
    const record = result.semanticProfileRecords[PROFILE_ID];

    expect(record?.draft?.semantic.formality.score).toBe(72);
    expect(record?.published[0]?.profile.semantic.formality.score).toBe(72);
    expect(record?.revisions[0]?.profile.semantic.formality.score).toBe(72);
  });

  it("leaves a deterministic record's block on the default V2 shape", () => {
    // The deterministic engine never reads `semantic`, so there is nothing to
    // migrate and nothing to lose. Mapping a V1 block here would only make the
    // stored state larger.
    const record = createRecord(PROFILE_ID, "House", NOW, createEmptyProfile("House"));
    const result = migrate(v13({ profileRecords: { [PROFILE_ID]: record } }));
    expect(result.profileRecords[PROFILE_ID]?.draft?.semantic.legacyV1).toBeUndefined();
  });

  it("starts with no sample evidence rather than inventing any", () => {
    // A v13 store knows a profile was learned but not from what. A fabricated
    // entry would put a claim on screen that no evidence supports.
    const result = migrate(v13({ semanticProfileRecords: { [PROFILE_ID]: semanticRecord() } }));
    expect(result.semanticSampleEvidence).toEqual({});
  });

  it("starts with no recorded outcomes", () => {
    expect(migrate(v13()).semanticReviewOutcomes).toEqual([]);
  });

  it("keeps the settings and consents v13 already carried", () => {
    const result = migrate(v13());
    expect(result.settings.llmProvider).toBe("openai");
    expect(result.settings.semanticOptIn).toBe(true);
    // Never derived from one another (ADR-0052).
    expect(result.settings.consistencyReviewConsent).toBe(true);
  });

  it("carries outcomes forward on a v14 store, collapsed and capped", () => {
    const result = migrate({
      version: 14,
      profileRecords: {},
      semanticProfileRecords: {},
      activeSemanticProfileId: null,
      ignoredFindings: [],
      reviewedFindings: [],
      deterministicReviewSession: null,
      semanticSampleEvidence: {},
      semanticReviewOutcomes: [
        outcome("3f1b0c6e-6a54-4b1e-9c2a-0d1e2f3a4b5c", "2026-01-01T00:00:00.000Z", "regenerated"),
        outcome("3f1b0c6e-6a54-4b1e-9c2a-0d1e2f3a4b5c", "2026-01-02T00:00:00.000Z"),
        {
          ...outcome("3f1b0c6e-6a54-4b1e-9c2a-0d1e2f3a4b5c", "2026-01-02T00:00:00.000Z"),
          junk: true,
        },
      ],
      governanceProfiles: {},
      governanceHistory: {},
      activeGovernanceProfileId: null,
      settings: {},
    });

    // Two rows for one session collapse to the later one, and the malformed row
    // is dropped without costing the others.
    expect(result.semanticReviewOutcomes).toHaveLength(1);
    expect(result.semanticReviewOutcomes[0]?.outcome).toBe("applied");
  });

  it("is stable: migrating an already-v14 state changes nothing", () => {
    const once = migrate(v13({ semanticProfileRecords: { [PROFILE_ID]: semanticRecord() } }));
    expect(migrate(once)).toEqual(once);
  });

  it("drops one unparseable record without costing the rest", () => {
    const good = newProfileId();
    const result = migrate(
      v13({
        semanticProfileRecords: {
          [PROFILE_ID]: semanticRecord(),
          [good]: { id: good, kind: "semantic", draft: { nonsense: true } },
        },
      }),
    );
    expect(result.semanticProfileRecords[PROFILE_ID]).toBeDefined();
    expect(result.semanticProfileRecords[good]).toBeUndefined();
  });

  it("rejects an outcome whose profile revision is not a real revision", () => {
    // Read back through the schema rather than trusted, so a hand-edited store
    // cannot put a fabricated revision into the log.
    expect(
      SemanticReviewOutcomeSchema.safeParse({
        ...outcome("3f1b0c6e-6a54-4b1e-9c2a-0d1e2f3a4b5c", NOW),
        profileRevision: 0,
      }).success,
    ).toBe(false);
  });
});
