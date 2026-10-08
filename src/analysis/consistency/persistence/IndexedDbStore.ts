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
    const transaction = db.transaction(STORE_NAME, mode);
    const result = request(run(transaction.objectStore(STORE_NAME)));
    // Resolve only after the transaction commits, not when the request succeeds.
    // A request can succeed before the transaction commits; resolving early would
    // let a caller read a value that has not yet been persisted.
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    });
    return result;
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
    // Keep the entire wipe in a single transaction: getAll + delete must not
    // yield to the event loop, or the transaction auto-commits and the deletes
    // fail with TransactionInactiveError.
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        const all = getAllReq.result as unknown[];
        const expired = all
          .map((raw) => ConsistencyStoreRecordSchema.safeParse(raw))
          .filter(
            (parsed): parsed is { success: true; data: ConsistencyStoreRecord } =>
              parsed.success && isExpired(parsed.data.updatedAt, nowIso),
          )
          .map((parsed) => parsed.data.revision);
        if (expired.length === 0) {
          resolve(0);
          return;
        }
        let completed = 0;
        expired.forEach((revision) => {
          const delReq = store.delete(revision);
          delReq.onsuccess = () => {
            completed += 1;
            if (completed === expired.length) resolve(expired.length);
          };
          delReq.onerror = () => reject(delReq.error ?? new Error("IndexedDB delete failed."));
        });
      };
      getAllReq.onerror = () => reject(getAllReq.error ?? new Error("IndexedDB getAll failed."));
    });
  }
}
