import { z } from "zod";

/**
 * The store interface (D2).
 *
 * One encrypted per-document store, mandatory. The logical tables are object
 * stores; field encryption is WebCrypto AES-GCM with a per-document data key
 * wrapped by the device key. No SQL.js, no bespoke `crypto.ts` beyond the
 * WebCrypto wrapper. TTL wipe removes a document's store when it expires, and
 * stale evidence invalidates the exceptions built on it.
 */

/** Schema version of the persisted store. Bumped on every shape change. */
export const CONSISTENCY_STORE_VERSION = 1;

/** What the store holds for one document revision. */
export const ConsistencyStoreRecordSchema = z.object({
  version: z.number().int().min(1),
  revision: z.string().trim().min(1),
  /** ISO timestamp of the last write. */
  updatedAt: z.string(),
  /** Encrypted payload. The store never sees plaintext. */
  ciphertext: z.string(),
  /** Nonce used for the encryption. */
  nonce: z.string(),
});

export type ConsistencyStoreRecord = z.infer<typeof ConsistencyStoreRecordSchema>;

/**
 * The store contract. `IndexedDbStore` is the production implementation;
 * `MemoryStore` is the test double. Both hold ciphertext only.
 */
export interface ConsistencyStore {
  readonly name: "indexedDb" | "memory";
  load(revision: string): Promise<ConsistencyStoreRecord | null>;
  save(record: ConsistencyStoreRecord): Promise<void>;
  remove(revision: string): Promise<void>;
  /** Remove every record older than the TTL. Returns the count removed. */
  wipeExpired(nowIso: string): Promise<number>;
}
