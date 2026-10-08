import { describe, expect, it, vi } from "vitest";
import { IndexedDbStore } from "../../../../../src/analysis/consistency/persistence/IndexedDbStore";
import type { ConsistencyStoreRecord } from "../../../../../src/analysis/consistency/contracts";

/**
 * Minimal in-memory IndexedDB mock.
 *
 * Implements only what IndexedDbStore uses: open, transaction, objectStore,
 * get, put, delete, getAll. The mock is synchronous under the hood but
 * resolves via microtasks to match the real IDB async contract.
 */
function createIdbMock() {
  const data = new Map<string, unknown>();

  function makeRequest<T>(result: T): IDBRequest<T> {
    const req = {
      error: null as DOMException | null,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
    } as unknown as IDBRequest<T>;
    queueMicrotask(() => {
      Object.defineProperty(req, "result", { value: result, writable: false });
      req.onsuccess?.({} as Event);
    });
    return req;
  }

  function makeObjectStore(): IDBObjectStore {
    return {
      get: (key: string) => makeRequest(data.get(key)),
      put: (value: { revision: string }) => {
        data.set(value.revision, value);
        return makeRequest(undefined);
      },
      delete: (key: string) => {
        data.delete(key);
        return makeRequest(undefined);
      },
      getAll: () => makeRequest([...data.values()]),
      createIndex: () => undefined,
      index: () => undefined,
      deleteIndex: () => undefined,
      count: () => makeRequest(data.size),
      openCursor: () => makeRequest(null),
      openKeyCursor: () => makeRequest(null),
      getKey: () => makeRequest(undefined),
    } as unknown as IDBObjectStore;
  }

  function makeTransaction(): IDBTransaction {
    const tx = {
      objectStore: () => makeObjectStore(),
      commit: () => undefined,
      abort: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
      oncomplete: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onabort: null as ((event: Event) => void) | null,
    } as unknown as IDBTransaction;
    // Fire oncomplete on the next microtask, after the request's onsuccess.
    // This matches real IDB: the transaction completes after all requests
    // in it have succeeded.
    queueMicrotask(() => {
      tx.oncomplete?.({} as Event);
    });
    return tx;
  }

  function makeDatabase(): IDBDatabase {
    return {
      objectStoreNames: {
        contains: (name: string) => name === "revisions",
      },
      createObjectStore: () => makeObjectStore(),
      deleteObjectStore: () => undefined,
      transaction: () => makeTransaction(),
      close: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as IDBDatabase;
  }

  const factory = {
    open: (_name: string, _version: number) => {
      const req = {
        error: null as DOMException | null,
        onsuccess: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => {
        // Set result BEFORE firing onupgradeneeded, matching real IDB behavior
        const db = makeDatabase();
        Object.defineProperty(req, "result", { value: db, writable: false });
        req.onupgradeneeded?.({} as IDBVersionChangeEvent);
        req.onsuccess?.({} as Event);
      });
      return req;
    },
    deleteDatabase: () => makeRequest(undefined),
    databases: () => makeRequest([]),
    cmp: () => 0,
  } as unknown as IDBFactory;

  return { factory, data };
}

function record(revision: string, updatedAt: string): ConsistencyStoreRecord {
  return {
    version: 1,
    revision,
    updatedAt,
    ciphertext: "ciphertext",
    nonce: "nonce",
  };
}

describe("IndexedDbStore", () => {
  it("returns null when a revision is absent", async () => {
    const { factory } = createIdbMock();
    vi.stubGlobal("indexedDB", factory);
    const store = new IndexedDbStore();
    expect(await store.load("missing")).toBeNull();
  });

  it("saves and loads a record", async () => {
    const { factory } = createIdbMock();
    vi.stubGlobal("indexedDB", factory);
    const store = new IndexedDbStore();
    const rec = record("r1", "2026-10-06T00:00:00.000Z");
    await store.save(rec);
    expect(await store.load("r1")).toEqual(rec);
  });

  it("parses on write and rejects a malformed record", async () => {
    const { factory } = createIdbMock();
    vi.stubGlobal("indexedDB", factory);
    const store = new IndexedDbStore();
    const bad = { ...record("r1", "2026-10-06T00:00:00.000Z"), version: "not-a-number" };
    await expect(store.save(bad as unknown as ConsistencyStoreRecord)).rejects.toThrow();
  });

  it("parses on read and rejects a malformed stored record", async () => {
    const { factory, data } = createIdbMock();
    vi.stubGlobal("indexedDB", factory);
    // Inject a malformed record directly into the backing store
    data.set("bad", {
      version: "not-a-number",
      revision: "bad",
      updatedAt: "x",
      ciphertext: "c",
      nonce: "n",
    });
    const store = new IndexedDbStore();
    await expect(store.load("bad")).rejects.toThrow();
  });

  it("removes a record", async () => {
    const { factory } = createIdbMock();
    vi.stubGlobal("indexedDB", factory);
    const store = new IndexedDbStore();
    await store.save(record("r1", "2026-10-06T00:00:00.000Z"));
    await store.remove("r1");
    expect(await store.load("r1")).toBeNull();
  });

  it("wipes only expired records", async () => {
    const { factory } = createIdbMock();
    vi.stubGlobal("indexedDB", factory);
    const store = new IndexedDbStore();
    await store.save(record("fresh", "2026-10-06T00:00:00.000Z"));
    await store.save(record("stale", "2026-09-28T00:00:00.000Z"));
    const removed = await store.wipeExpired("2026-10-06T12:00:00.000Z");
    expect(removed).toBe(1);
    expect(await store.load("fresh")).not.toBeNull();
    expect(await store.load("stale")).toBeNull();
  });

  it("throws a clear error when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const store = new IndexedDbStore();
    await expect(store.load("r1")).rejects.toThrow("IndexedDB is not available");
  });
});
