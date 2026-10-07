import { describe, expect, it } from "vitest";
import { ConsistencySessionStore } from "../../../../../src/analysis/consistency/persistence/index";
import { MemoryStore } from "../../../../../src/analysis/consistency/persistence/MemoryStore";
import { buildProvenance } from "../../../../../src/analysis/consistency/persistence/audit";
import { generateDataKey } from "../../../../../src/analysis/consistency/persistence/encryption";
import type { ConsistencyAuditRecord } from "../../../../../src/analysis/consistency/persistence/audit";
import type { ConsistencyReport } from "../../../../../src/analysis/consistency/contracts";

function report(overrides: Partial<ConsistencyReport> = {}): ConsistencyReport {
  return {
    revision: "r1",
    issues: [],
    coverage: {
      complete: true,
      statementsConsidered: 2,
      statementsTotal: 2,
      comparisonsMade: 1,
      blockOverflowSkipped: 0,
      adjudicationsUsed: 0,
      adjudicationsAvailable: 60,
      perCheck: {},
      limitations: [],
      modelAdjudicated: 0,
      quarantinedClaims: 0,
      deterministicResolved: 0,
      decisionAdjudicated: 0,
      unresolved: 0,
      gated: 0,
      reviewBandSuppressed: 0,
      budgetExceeded: 0,
    },
    usedModel: false,
    startedAt: "2026-10-06T00:00:00.000Z",
    finishedAt: "2026-10-06T00:00:01.000Z",
    ...overrides,
  };
}

function provenanceInput() {
  return {
    documentFingerprint: "fp-abc",
    claimGraphSchemaVersion: "1.0",
    extractionPromptVersion: "1.0",
    generalModel: "gpt-4",
    decisionProvider: "system_one",
    decisionModel: "gpt-4",
    questionSetVersion: "1.0",
    confidenceProfileVersion: "1.0",
    createdAt: "2026-10-06T00:00:00.000Z",
  };
}

async function auditRecord(revision: string): Promise<ConsistencyAuditRecord> {
  const { buildAuditRecord } =
    await import("../../../../../src/analysis/consistency/persistence/audit");
  return buildAuditRecord(report({ revision }), buildProvenance(provenanceInput()), ["hash-1"]);
}

describe("ConsistencySessionStore", () => {
  it("saves and loads an audit record round-trip", async () => {
    const store = new ConsistencySessionStore(new MemoryStore(), await generateDataKey());
    const record = await auditRecord("r1");
    await store.save(record, "2026-10-06T00:00:00.000Z");
    const loaded = await store.load("r1");
    expect(loaded).toEqual(record);
  });

  it("returns null when the revision is absent", async () => {
    const store = new ConsistencySessionStore(new MemoryStore(), await generateDataKey());
    expect(await store.load("missing")).toBeNull();
  });

  it("stores ciphertext, not plaintext", async () => {
    const memory = new MemoryStore();
    const store = new ConsistencySessionStore(memory, await generateDataKey());
    const record = await auditRecord("r1");
    await store.save(record, "2026-10-06T00:00:00.000Z");
    const stored = await memory.load("r1");
    expect(stored).not.toBeNull();
    expect(stored!.ciphertext).not.toContain("fp-abc");
    expect(stored!.nonce).toBeTruthy();
  });

  it("removes a record", async () => {
    const store = new ConsistencySessionStore(new MemoryStore(), await generateDataKey());
    await store.save(await auditRecord("r1"), "2026-10-06T00:00:00.000Z");
    await store.remove("r1");
    expect(await store.load("r1")).toBeNull();
  });

  it("wipes expired records through the inner store", async () => {
    const memory = new MemoryStore();
    const store = new ConsistencySessionStore(memory, await generateDataKey());
    await store.save(await auditRecord("r1"), "2026-09-28T00:00:00.000Z");
    const removed = await store.wipeExpired("2026-10-06T12:00:00.000Z");
    expect(removed).toBe(1);
  });
});
