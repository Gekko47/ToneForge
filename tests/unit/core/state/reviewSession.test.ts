/**
 * Spec §16: the review session, and the identity its decisions expire with.
 *
 * The tests below are written around one question asked repeatedly in different
 * words: *may this approval still be applied?* The answer has to be derivable
 * from stored state alone, because that is all Apply has.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  changedIdentityFields,
  type ReviewSessionIdentity,
} from "../../../../src/core/domain/ReviewSession";
import {
  clearReviewDecision,
  clearReviewSession,
  ensureReviewSession,
  loadReviewSession,
  saveReviewDecision,
} from "../../../../src/core/state/reviewSession";
import { loadState, saveState } from "../../../../src/core/state/persistence";
import { migrate } from "../../../../src/core/state/migration";

const IDENTITY: ReviewSessionIdentity = {
  documentId: "doc-1",
  documentVersion: "v7",
  contentHash: "hash-a",
  structuralHash: "shape-a",
  profileId: "11111111-1111-4111-8111-111111111111",
  profileRevision: 3,
  governancePolicyRevision: 2,
  coverageFingerprint: "fp-a",
};

const DECISION = {
  identity: "typography.emDash@0",
  ruleId: "typography/dashes",
  category: "typography.emDash",
  decision: "approved" as const,
  expected: "—",
  decidedAt: "2026-01-01T00:00:00.000Z",
};

function reset(): void {
  clearReviewSession();
  saveState({
    ...loadState(),
    version: 13,
    deterministicReviewSession: null,
  });
}

describe("the review session", () => {
  beforeEach(reset);

  it("has no session until one is started", () => {
    expect(loadReviewSession()).toBeNull();
  });

  it("starts empty, and says so without invalidating anything", () => {
    const { session, invalidatedBy } = ensureReviewSession(IDENTITY);
    expect(session.decisions).toEqual([]);
    expect(invalidatedBy).toEqual([]);
    expect(loadReviewSession()?.identity).toEqual(IDENTITY);
  });

  it("refuses a decision that is not bound to an identity", () => {
    // The one thing this design exists to prevent: an approval with nothing to
    // invalidate it. Refusing at the write is better than accepting it and
    // hoping a later read can tell whether it still applies.
    expect(() => saveReviewDecision(DECISION)).toThrow(/no review session is in force/);
  });

  it("records a decision and reads it back", () => {
    ensureReviewSession(IDENTITY);
    saveReviewDecision(DECISION);
    expect(loadReviewSession()?.decisions).toHaveLength(1);
  });

  it("keeps one decision per occurrence, the latest winning", () => {
    ensureReviewSession(IDENTITY);
    saveReviewDecision(DECISION);
    saveReviewDecision({ ...DECISION, decision: "skipped", expected: null });
    const decisions = loadReviewSession()?.decisions ?? [];
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe("skipped");
  });

  it("withdraws a decision so the occurrence can be reviewed again", () => {
    ensureReviewSession(IDENTITY);
    saveReviewDecision(DECISION);
    clearReviewDecision(DECISION.identity);
    expect(loadReviewSession()?.decisions).toEqual([]);
  });

  it("discards the whole session when the document has changed", () => {
    ensureReviewSession(IDENTITY);
    saveReviewDecision(DECISION);

    const { session, invalidatedBy } = ensureReviewSession({ ...IDENTITY, contentHash: "hash-b" });

    expect(session.decisions).toEqual([]);
    // Named, not merely dropped: the pane has to be able to say why the user's
    // approvals are gone rather than showing an empty list as if there had
    // never been any.
    expect(invalidatedBy).toEqual(["contentHash"]);
  });

  it.each([
    ["documentId", { documentId: "doc-2" }],
    ["documentVersion", { documentVersion: "v8" }],
    ["contentHash", { contentHash: "hash-b" }],
    ["structuralHash", { structuralHash: "shape-b" }],
    ["profileId", { profileId: "22222222-2222-4222-8222-222222222222" }],
    ["profileRevision", { profileRevision: 4 }],
    ["governancePolicyRevision", { governancePolicyRevision: 3 }],
    ["coverageFingerprint", { coverageFingerprint: "fp-b" }],
  ])("invalidates when %s moves", (field, change) => {
    ensureReviewSession(IDENTITY);
    saveReviewDecision(DECISION);

    const { session, invalidatedBy } = ensureReviewSession({ ...IDENTITY, ...change });

    expect(session.decisions).toEqual([]);
    expect(invalidatedBy).toEqual([field]);
  });

  it("keeps the session when nothing has moved", () => {
    ensureReviewSession(IDENTITY);
    saveReviewDecision(DECISION);
    const { session, invalidatedBy } = ensureReviewSession({ ...IDENTITY });
    expect(invalidatedBy).toEqual([]);
    expect(session.decisions).toHaveLength(1);
  });

  it("refuses to persist a session it cannot read back", () => {
    // A half-written session, as a storage backend can produce. It must not be
    // written: ToneForge would otherwise have to invent the missing identity
    // fields on the way back in, and an invented identity can never expire.
    const halfWritten = {
      ...loadState(),
      version: 13,
      deterministicReviewSession: { identity: { documentId: "doc-1" } },
    } as unknown as Parameters<typeof saveState>[0];
    expect(() => saveState(halfWritten)).toThrow();
  });

  it("names the fields that differ, in schema order", () => {
    expect(
      changedIdentityFields(IDENTITY, { ...IDENTITY, profileRevision: 9, contentHash: "z" }),
    ).toEqual(["contentHash", "profileRevision"]);
  });
});

describe("the v12 to v13 migration", () => {
  it("starts the session empty rather than promoting old reviewed findings", () => {
    const migrated = migrate({
      version: 12,
      profileRecords: {},
      activeProfileId: null,
      ignoredFindings: [],
      // A v12 record's reviewed findings: real decisions about a real document,
      // with no identity recorded anywhere.
      reviewedFindings: [
        {
          identity: "typography.emDash@0",
          findingId: "33333333-3333-4333-8333-333333333333",
          category: "typography.emDash",
          nodeIds: [],
          range: { start: 0, end: 2, unit: "character" },
          changeId: "44444444-4444-4444-8444-444444444444",
          reviewedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      governanceProfiles: {},
      governanceHistory: {},
      activeGovernanceProfileId: null,
      settings: {},
    });

    expect(migrated.version).toBe(13);
    // Carried: the durable "the user has seen this" record.
    expect(migrated.reviewedFindings).toHaveLength(1);
    // Not promoted: a v12 approval has no document, profile, governance or
    // coverage identity attached, so it cannot be shown to still apply.
    expect(migrated.deterministicReviewSession).toBeNull();
  });

  it("leaves a corrupt session null rather than failing the load", () => {
    const migrated = migrate({
      version: 13,
      profileRecords: {},
      ignoredFindings: [],
      reviewedFindings: [],
      deterministicReviewSession: "not a session",
      settings: {},
    });
    expect(migrated.deterministicReviewSession).toBeNull();
  });
});
