import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../../../../src/analysis/consistency/persistence/MemoryStore";
import type { ConsistencyStoreRecord } from "../../../../../src/analysis/consistency/contracts";

function record(revision: string, updatedAt: string): ConsistencyStoreRecord {
  return {
    version: 1,
    revision,
    updatedAt,
    ciphertext: "ciphertext",
    nonce: "nonce",
  };
}

describe("MemoryStore", () => {
  it("returns null when a revision is absent", async () => {
    const store = new MemoryStore();
    expect(await store.load("missing")).toBeNull();
  });

  it("saves and loads a record", async () => {
    const store = new MemoryStore();
    const rec = record("r1", "2026-10-06T00:00:00.000Z");
    await store.save(rec);
    expect(await store.load("r1")).toEqual(rec);
  });

  it("parses on write and rejects a malformed record", async () => {
    const store = new MemoryStore();
    const bad = { ...record("r1", "2026-10-06T00:00:00.000Z"), version: "not-a-number" };
    await expect(store.save(bad as unknown as ConsistencyStoreRecord)).rejects.toThrow();
  });

  it("removes a record", async () => {
    const store = new MemoryStore();
    await store.save(record("r1", "2026-10-06T00:00:00.000Z"));
    await store.remove("r1");
    expect(await store.load("r1")).toBeNull();
  });

  it("wipes only expired records", async () => {
    const store = new MemoryStore();
    await store.save(record("fresh", "2026-10-06T00:00:00.000Z"));
    await store.save(record("stale", "2026-09-28T00:00:00.000Z"));
    const removed = await store.wipeExpired("2026-10-06T12:00:00.000Z");
    expect(removed).toBe(1);
    expect(await store.load("fresh")).not.toBeNull();
    expect(await store.load("stale")).toBeNull();
  });

  it("returns the name 'memory'", () => {
    expect(new MemoryStore().name).toBe("memory");
  });
});
