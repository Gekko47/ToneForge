import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { CURRENT_STATE_VERSION, migrate } from "../../../../src/core/state/migration";
import { selectActiveProfile } from "../../../../src/core/state/profileSelectors";

/**
 * The v10 -> v11 step splits the profile namespaces and adds two settings.
 *
 * Every change in this step is **additive and defaulting**. Nothing a v10 record
 * held is dropped, and nothing is invented: a v10 record is by definition a
 * deterministic one, so it becomes `kind: "deterministic"` and the semantic map
 * starts empty.
 *
 * The step deliberately does **not** extract each profile's `semantic` block into
 * a new semantic record. ToneForge has no users yet, so there is no learned style
 * to preserve, and a copy would fabricate a profile the user never created. The
 * first semantic profile is created by running Learn Style.
 */

function v10(
  settings: Record<string, unknown> = {},
  records: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 10,
    profileRecords: records,
    activeProfileId: null,
    governanceProfiles: {},
    governanceHistory: {},
    activeGovernanceProfileId: null,
    providerConnections: {},
    settings: {
      llmProvider: "mock",
      openAiCredentialMode: "broker",
      consistencyReviewConsent: false,
      semanticOptIn: false,
      ...settings,
    },
  };
}

/** A v10 record: no `kind`, and carrying a populated `semantic` block. */
function legacyRecord(name = "House"): Record<string, unknown> {
  const now = "2026-01-01T00:00:00.000Z";
  const id = uuidv4();
  return {
    id,
    name,
    draft: {
      id,
      name,
      revision: 1,
      measured: {},
      // Deliberately populated in the V1 shape: this is the block a naive
      // migration would copy into a semantic record, and the test asserts that
      // it does not. It also exercises the V1 -> V2 read upgrade, because a v10
      // store's block predates the V2 schema exactly as a v13 store's does.
      semantic: { tone: "formal", formality: 80, avoidWords: ["utilise"] },
      typography: { emDash: "em" },
      houseStyle: { bannedTerms: ["utilise"] },
      createdAt: now,
      updatedAt: now,
      sourceSampleIds: [],
    },
    published: [],
    revisions: [],
    activePublishedRevision: null,
    nextRevision: 2,
    createdAt: now,
    updatedAt: now,
  };
}

describe("migration v10 to v11", () => {
  it("lands on the current version", () => {
    expect(migrate(v10()).version).toBe(CURRENT_STATE_VERSION);
  });

  it("starts the semantic namespace empty and nothing active", () => {
    // There is no semantic profile until one is created, and the Semantic tab
    // has to be able to say so rather than fall back to a deterministic profile.
    const result = migrate(v10());
    expect(result.semanticProfileRecords).toEqual({});
    expect(result.activeSemanticProfileId).toBeNull();
  });

  it("starts the ignore list empty", () => {
    expect(migrate(v10()).ignoredFindings).toEqual([]);
  });

  it("keeps a v10 record as a deterministic one", () => {
    const record = legacyRecord();
    const id = record.id as string;
    const result = migrate(v10({}, { [id]: record }));

    const stored = result.profileRecords[id];
    expect(stored?.kind).toBe("deterministic");
    expect(stored?.draft?.kind).toBe("deterministic");
  });

  it("does not extract the semantic block into a profile the user never made", () => {
    // The reason this step exists at all. A copy would present a learned tone as
    // a profile the user authored and had to reason about.
    const record = legacyRecord();
    const result = migrate(v10({}, { [record.id as string]: record }));

    expect(Object.keys(result.semanticProfileRecords)).toHaveLength(0);
    // The block itself is not discarded, so a future change can still recover
    // it. It is mapped forward rather than copied verbatim: the stored schema
    // upgrades a V1 block on read, so `tone` is the V2 group and the original
    // free string is retained in both its description and the legacy carrier.
    const semantic = result.profileRecords[record.id as string]?.draft?.semantic;
    expect(semantic?.tone.description).toBe("formal");
    expect(semantic?.legacyV1?.tone).toBe("formal");
  });

  it("keeps the deterministic review reading the same profile as before", () => {
    // The v10 record was the one the whole-document check ran against, so the
    // split must not move it out from under the scanner.
    const record = legacyRecord();
    const result = migrate(v10({}, { [record.id as string]: record }));

    const active = selectActiveProfile(result, "deterministic");
    expect(active?.name).toBe("House");
    expect(active?.typography.emDash).toBe("em");
  });

  it("gives a user with no semantic profile a null rather than a fallback", () => {
    // The fallback must never cross namespaces: a semantic profile reaching the
    // rules engine would apply AI-derived tone settings deterministically.
    const record = legacyRecord();
    const result = migrate(v10({}, { [record.id as string]: record }));
    expect(selectActiveProfile(result, "semantic")).toBeNull();
  });

  it("defaults autoScan to on, preserving the v10 behaviour", () => {
    expect(migrate(v10()).settings.autoScan).toBe(true);
  });

  it("keeps autoScan off when the user had turned it off", () => {
    // A stored `false` is a real decision. Reading it as anything else would
    // silently resume scanning a document the user asked not to have scanned.
    expect(migrate(v10({ autoScan: false })).settings.autoScan).toBe(false);
  });

  it("preserves the settings v10 already carried", () => {
    const result = migrate(
      v10({
        llmProvider: "openrouter",
        semanticOptIn: true,
        consistencyReviewConsent: true,
        openAiModel: "anthropic/claude-sonnet-4",
      }),
    );
    expect(result.settings.llmProvider).toBe("openrouter");
    expect(result.settings.semanticOptIn).toBe(true);
    // Never derived from another consent: a user who agreed to the consistency
    // engine agreed to that specifically (ADR-0052).
    expect(result.settings.consistencyReviewConsent).toBe(true);
    expect(result.settings.openAiModel).toBe("anthropic/claude-sonnet-4");
  });

  it("is stable: migrating an already-v11 state changes nothing", () => {
    const once = migrate(v10({}, { [uuidv4()]: legacyRecord() }));
    const twice = migrate(once);
    expect(twice).toEqual(once);
  });

  it("ignores a stored semantic block rather than trusting it", () => {
    // A hand-edited or future-shaped blob carrying semantic records must not be
    // adopted silently. Nothing in v10 ever wrote them, so their presence means
    // the blob did not come from this app.
    const result = migrate({
      ...v10(),
      semanticProfileRecords: { [uuidv4()]: legacyRecord("Injected") },
      activeSemanticProfileId: uuidv4(),
    });
    expect(Object.keys(result.semanticProfileRecords)).toHaveLength(0);
    expect(result.activeSemanticProfileId).toBeNull();
  });
});
