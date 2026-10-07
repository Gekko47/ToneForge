/**
 * In-memory `ConsistencyStore` (R7).
 *
 * The test double, and the fallback when a host has no IndexedDB. It holds
 * ciphertext only, exactly like the production store, so a test that passes
 * here is exercising the same contract the real store must honour.
 */

import {
  ConsistencyStoreRecordSchema,
  type ConsistencyStore,
  type ConsistencyStoreRecord,
} from "../contracts";
import { isExpired } from "./audit";

export class MemoryStore implements ConsistencyStore {
  readonly name = "memory" as const;
  private readonly records = new Map<string, ConsistencyStoreRecord>();

  async load(revision: string): Promise<ConsistencyStoreRecord | null> {
    return this.records.get(revision) ?? null;
  }

  async save(record: ConsistencyStoreRecord): Promise<void> {
    // Parse on write, not on read: a malformed record must never enter the
    // store, so a later load cannot hand the engine a shape it did not expect.
    this.records.set(record.revision, ConsistencyStoreRecordSchema.parse(record));
  }

  async remove(revision: string): Promise<void> {
    this.records.delete(revision);
  }

  async wipeExpired(nowIso: string): Promise<number> {
    let removed = 0;
    for (const [revision, record] of this.records) {
      if (isExpired(record.updatedAt, nowIso)) {
        this.records.delete(revision);
        removed += 1;
      }
    }
    return removed;
  }
}
