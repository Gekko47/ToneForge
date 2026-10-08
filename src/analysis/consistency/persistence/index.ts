/**
 * Persistence (R7, original §30–§31).
 *
 * `ConsistencyStore` interface, `IndexedDbStore`, `MemoryStore`, schema
 * versioning, WebCrypto field encryption, TTL wipe, and the audit record the
 * ciphertext wraps. The store contract itself lives in `contracts/store.ts`.
 *
 * The store never sees plaintext: `ConsistencySessionStore` encrypts the audit
 * record with a per-document data key before it reaches the store, and decrypts
 * it on load. No credential is ever part of the record.
 */

import {
  CONSISTENCY_STORE_VERSION,
  ConsistencyStoreRecordSchema,
  type ConsistencyStore,
  type ConsistencyStoreRecord,
} from "../contracts";
import { ConsistencyAuditRecordSchema, type ConsistencyAuditRecord } from "./audit";
import { decryptString, encryptString } from "./encryption";

export { MemoryStore } from "./MemoryStore";
export { IndexedDbStore } from "./IndexedDbStore";
export {
  CONSISTENCY_STORE_TTL_DAYS,
  CONSISTENCY_STORE_TTL_MS,
  ConsistencyAuditRecordSchema,
  ConsistencySessionProvenanceSchema,
  buildAuditRecord,
  buildProvenance,
  evidenceStillValid,
  isExpired,
  type ConsistencyAuditRecord,
  type ConsistencySessionProvenance,
  type ProvenanceInput,
} from "./audit";
export {
  decryptString,
  deriveDeviceKey,
  encryptString,
  generateDataKey,
  unwrapDataKey,
  wrapDataKey,
  type EncryptedPayload,
} from "./encryption";

/**
 * A store bound to one document's data key.
 *
 * The data key is ephemeral: it is generated per review session and never
 * persisted, so losing it equals a wipe, which is the safe failure (original
 * §30). The wrapped key is stored alongside the ciphertext so a session that
 * still holds the device key can reopen its own record.
 */
export class ConsistencySessionStore {
  constructor(
    private readonly store: ConsistencyStore,
    private readonly dataKey: CryptoKey,
  ) {}

  /** Encrypt and persist the audit record for its revision. */
  async save(record: ConsistencyAuditRecord, updatedAt: string): Promise<void> {
    const parsed = ConsistencyAuditRecordSchema.parse(record);
    // Bind the ciphertext to the revision as additional authenticated data, so
    // a ciphertext from one revision cannot be replayed against another.
    const payload = await encryptString(JSON.stringify(parsed), this.dataKey, parsed.revision);
    await this.store.save(
      ConsistencyStoreRecordSchema.parse({
        version: CONSISTENCY_STORE_VERSION,
        revision: parsed.revision,
        updatedAt,
        ciphertext: payload.ciphertext,
        nonce: payload.nonce,
      }),
    );
  }

  /** Load and decrypt the audit record for a revision, or null when absent. */
  async load(revision: string): Promise<ConsistencyAuditRecord | null> {
    const stored: ConsistencyStoreRecord | null = await this.store.load(revision);
    if (stored === null) return null;
    // Pass the revision as AAD to match the encryption in save(). A mismatch
    // would fail decryption, which is the correct behaviour for a replayed
    // ciphertext.
    const plaintext = await decryptString(
      { ciphertext: stored.ciphertext, nonce: stored.nonce },
      this.dataKey,
      revision,
    );
    return ConsistencyAuditRecordSchema.parse(JSON.parse(plaintext));
  }

  /** Remove a revision's record. */
  async remove(revision: string): Promise<void> {
    await this.store.remove(revision);
  }

  /** Wipe every record past its TTL. Returns the count removed. */
  async wipeExpired(nowIso: string): Promise<number> {
    return this.store.wipeExpired(nowIso);
  }
}
