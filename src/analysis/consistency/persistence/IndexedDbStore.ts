/**
 * IndexedDB `ConsistencyStore` (R7, original §30).
 *
 * The production store. One object store keyed by document revision, holding
 * ciphertext only — the same `ConsistencyStoreRecord` the memory double holds.
 * The logical tables of §30 are the audit record's fields, not separate object
 * stores: the engine reads and writes a whole revision at a time, so a single
 * store keyed by revision is the shape the access pattern actually has.
 *
 * A host without IndexedDB (jsdom, an old WebView) gets a clear error rather
 * than a silent no-op, so the caller can fall back to `MemoryStore` knowingly.
 */

import {
  ConsistencyStoreRecordSchema,
  type ConsistencyStore,
  type ConsistencyStoreRecord,
} from "../contracts";
import { isExpired } from "./audit";

const DB_NAME = "toneforge-consistency";
const STORE_NAME = "revisions";
const DB_VERSION = 1;

function indexedDb(): IDBFactory {
  const factory = globalThis.indexedDB;
  if (factory === undefined) {
    throw new Error("IndexedDB is not available in this environment.");
  }
  return factory;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed."));
  });
}

export class IndexedDbStore implements ConsistencyStore {
  readonly name = "indexedDb" as const;
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.db !== null) return this.db;
    this.db = new Promise((resolve, reject) => {
      const req = indexedDb().open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "revision" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed."));
    });
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
    const db = await this.open();
    return request(run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)));
  }

  async load(revision: string): Promise<ConsistencyStoreRecord | null> {
    const raw = await this.tx<unknown>("readonly", (store) => store.get(revision));
    if (raw === undefined) return null;
    // Parse on read: a record written by an older schema must not reach the
    // engine as a shape it did not expect.
    return ConsistencyStoreRecordSchema.parse(raw);
  }

  async save(record: ConsistencyStoreRecord): Promise<void> {
    const parsed = ConsistencyStoreRecordSchema.parse(record);
    await this.tx("readwrite", (store) => store.put(parsed));
  }

  async remove(revision: string): Promise<void> {
    await this.tx("readwrite", (store) => store.delete(revision));
  }

  async wipeExpired(nowIso: string): Promise<number> {
    const db = await this.open();
    const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
    const all = await request<unknown[]>(store.getAll());
    const expired = all
      .map((raw) => ConsistencyStoreRecordSchema.safeParse(raw))
      .filter((parsed) => parsed.success && isExpired(parsed.data.updatedAt, nowIso))
      .map((parsed) => (parsed.success ? parsed.data.revision : ""));
    await Promise.all(expired.map((revision) => request(store.delete(revision))));
    return expired.length;
  }
}
