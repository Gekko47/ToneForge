import { describe, expect, it } from "vitest";
import { migrate, CURRENT_STATE_VERSION } from "../../../../src/core/state/migration";
import { v4 as uuidv4 } from "uuid";

/**
 * The ignored-findings list was discarded on every load.
 *
 * `readCurrentState` is the branch a current-version store takes, and it
 * hardcoded `ignoredFindings: []` instead of reading the field. The store
 * version was already 11 and the schema already declared the array, so the
 * field looked wired: `ignoreFinding()` wrote it, `StateSchema` accepted it,
 * and the only place it was ever dropped was the one function every load runs.
 *
 * This is the exact shape of the user-reported bug — the Ignore button wrote
 * correctly, the ignored list never appeared, and nothing anywhere said why.
 * It is pinned here at the layer that lost it, separately from the notification
 * tests, because the two failures are independent: a write that does not notify
 * and a read that does not read both present as "Ignore does nothing".
 */

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fingerprint: `fp-${uuidv4()}`,
    findingId: uuidv4(),
    category: "typography",
    message: "An em dash was found.",
    range: { start: 10, end: 20 },
    nodeIds: ["n1"],
    ignoredAt: "2026-09-25T10:00:00.000Z",
    ...overrides,
  };
}

function v11(ignoredFindings: unknown): Record<string, unknown> {
  return {
    version: CURRENT_STATE_VERSION,
    profileRecords: {},
    activeProfileId: null,
    semanticProfileRecords: {},
    activeSemanticProfileId: null,
    ignoredFindings,
    governanceProfiles: {},
    governanceHistory: {},
    activeGovernanceProfileId: null,
    settings: {},
    providerConnections: [],
  };
}

describe("migration preserves the ignored-findings list", () => {
  it("reads the list back from a current-version store", () => {
    // The bug itself: a single well-formed entry, written by the real writer,
    // must survive a reload.
    const stored = entry({ message: "Two hyphens in a row." });

    const result = migrate(v11([stored]));

    expect(result.ignoredFindings).toHaveLength(1);
    expect(result.ignoredFindings[0]?.message).toBe("Two hyphens in a row.");
  });

  it("preserves every entry, not just the first", () => {
    const result = migrate(v11([entry(), entry(), entry()]));

    expect(result.ignoredFindings).toHaveLength(3);
  });

  it("preserves the fields the ignored list renders and restores with", () => {
    // The list offers "Go to text" and "Restore". Both need the fingerprint and
    // the range; losing them would leave a row that cannot do either.
    const result = migrate(v11([entry({ fingerprint: "rule-x", nodeIds: ["n1", "n2"] })]));

    const recovered = result.ignoredFindings[0];
    expect(recovered?.fingerprint).toBe("rule-x");
    expect(recovered?.nodeIds).toEqual(["n1", "n2"]);
    // `unit` is defaulted by RangeSchema, so the recovered value carries it.
    expect(recovered?.range).toMatchObject({ start: 10, end: 20 });
    expect(recovered?.ignoredAt).toBe("2026-09-25T10:00:00.000Z");
  });

  it("keeps the valid entries when one row is malformed", () => {
    // One bad row must not cost the user the rest of their ignores.
    const result = migrate(v11([entry({ message: "Good." }), { fingerprint: "" }, null, 42]));

    expect(result.ignoredFindings).toHaveLength(1);
    expect(result.ignoredFindings[0]?.message).toBe("Good.");
  });

  it("collapses a repeated fingerprint to the most recent entry", () => {
    // A fingerprint identifies a rule, so re-ignoring it should move the row
    // rather than accumulate duplicates the list would render twice.
    const result = migrate(
      v11([
        entry({ fingerprint: "rule-x", message: "Old", ignoredAt: "2026-09-01T00:00:00.000Z" }),
        entry({ fingerprint: "rule-x", message: "New", ignoredAt: "2026-09-25T00:00:00.000Z" }),
      ]),
    );

    expect(result.ignoredFindings).toHaveLength(1);
    expect(result.ignoredFindings[0]?.message).toBe("New");
  });

  it("returns an empty list for a store that has no such field", () => {
    // v10 and earlier never stored ignores, and a store written before the
    // field existed must not fail to load.
    const result = migrate(v11(undefined));

    expect(result.ignoredFindings).toEqual([]);
  });

  it("returns an empty list when the field is not an array", () => {
    expect(migrate(v11({ fingerprint: "rule-x" })).ignoredFindings).toEqual([]);
    expect(migrate(v11("nonsense")).ignoredFindings).toEqual([]);
  });

  it("starts empty for a v10 store, which never had the field", () => {
    // Migrating forward must not invent ignores the user never set.
    const result = migrate({
      version: 10,
      profileRecords: {},
      activeProfileId: null,
      governanceProfiles: {},
      governanceHistory: {},
      settings: {},
      providerConnections: [],
    });

    expect(result.ignoredFindings).toEqual([]);
    expect(result.version).toBe(CURRENT_STATE_VERSION);
  });
});
