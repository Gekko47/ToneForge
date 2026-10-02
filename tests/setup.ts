import { afterEach, vi } from "vitest";
import { createOfficeLoad } from "./fixtures/officeLoad";
import "@testing-library/jest-dom/vitest";
import { initializeIcons } from "@fluentui/react/lib/Icons";

// Register Fluent UI icons (ChevronDown, etc.) before any component renders.
// Without this, every ComboBox/Dropdown/Icon in the test suite emits
// "icon not registered" warnings to stderr. Guard with a module-level flag so
// re-registration across test files is idempotent instead of warning.
if (!(globalThis as { __toneforgeIconsInitialized?: boolean }).__toneforgeIconsInitialized) {
  initializeIcons();
  (globalThis as { __toneforgeIconsInitialized?: boolean }).__toneforgeIconsInitialized = true;
}

/**
 * Backing store for the `roamingSettings` mock.
 *
 * Hoisted to module scope and cleared after every test, because the mock now
 * round-trips for real. While `get` returned undefined the store read as
 * permanently empty, which hid the leak; a working mock persists like the real
 * one does, so a value saved by one test is otherwise visible to the next.
 */
const roamingStore = new Map<string, unknown>();

// Provide a minimal Office global so shared/word modules can be imported in tests.
/*
 * The range's `load` is a faithful double rather than `vi.fn()`.
 *
 * A bare spy accepts any arguments and records nothing, so a call the host would
 * **silently truncate** \u2014 `load("text", "start", "end")` against a one-argument
 * signature \u2014 is indistinguishable from a correct one here, and fails only in a
 * real Word. That is not hypothetical: it shipped, and ADR-0100 records it. The
 * double below throws on a variadic call, so the next one fails here first.
 *
 * Scoped to the range deliberately. The other `load: vi.fn()`s in this file model
 * objects whose reads are not asserted anywhere, and widening them all would
 * change what 2 350 tests are exercising for no gain.
 */
const rangeDouble = (extra: Record<string, unknown>): Record<string, unknown> => ({
  ...extra,
  load: createOfficeLoad(
    () => undefined,
    () => rangeDouble(extra),
  ),
});

const officeMock = {
  run: <T>(func: (context: unknown) => Promise<T>): Promise<T> =>
    func({
      document: {
        body: {
          text: "",
          load: vi.fn(),
          paragraphs: { load: vi.fn(), items: [] },
          getRange: vi.fn(() =>
            rangeDouble({
              text: "",
              insertText: vi.fn(function (this: unknown) {
                return this;
              }),
              insertBreak: vi.fn(),
              insertParagraph: vi.fn(() => ({ format: {}, load: vi.fn() })),
              paragraphs: { load: vi.fn(), items: [] },
              font: { name: "", size: 0, color: "", load: vi.fn(), set: vi.fn() },
              /*
               * Range.paragraphFormat, which is real — Word exposes it on a range,
               * and `revisionAdapter` sets paragraph formatting through one. The
               * comment is here because the *same name on a paragraph* is not real,
               * and this mock is a plausible thing to copy when building a paragraph
               * double.
               *
               * That mistake was made for real: 21ce84d added "paragraphFormat" to
               * the paragraph load plan on the assumption it was the way to reach
               * `Word.ParagraphFormat` from a paragraph, and so asked Word for a
               * property that does not exist there. The request is rejected whole,
               * which cost every other property in that group too. Do not read this
               * as evidence that a paragraph has one — see ADR-0084, and
               * `LOADABLE_PARAGRAPH_PROPERTIES` for the names a paragraph does have.
               */
              paragraphFormat: { set: vi.fn() },
              listFormat: { set: vi.fn() },
              style: "",
              set: vi.fn(function (this: unknown) {
                return this;
              }),
              load: vi.fn(),
            }),
          ),
        },
        selection: {
          text: "",
          insertText: vi.fn(),
          insertBreak: vi.fn(),
          insertParagraph: vi.fn(() => ({ format: {}, load: vi.fn() })),
          paragraphs: { load: vi.fn(), items: [] },
          font: { name: "", size: 0, color: "", load: vi.fn() },
          load: vi.fn(),
        },
        getSelection: vi.fn(() => ({
          text: "",
          insertText: vi.fn(),
          insertBreak: vi.fn(),
          insertParagraph: vi.fn(() => ({ format: {}, load: vi.fn() })),
          paragraphs: { load: vi.fn(), items: [] },
          font: { name: "", size: 0, color: "", load: vi.fn() },
          load: vi.fn(),
        })),
        styles: { name: "", load: vi.fn(), items: [] },
      },
      host: { name: "Word", version: "16.0" },
      sync: vi.fn(),
    }),
  /*
   * A working `roamingSettings` round-trip, not a pair of no-op spies.
   *
   * `loadState` prefers `roamingSettings` over `localStorage` whenever an Office
   * runtime is present, and this mock makes one present. With `get` returning
   * undefined the store therefore read as permanently empty while every write
   * landed in `localStorage` — so a persisted value could never be read back,
   * and a test asserting "the ignore was saved" failed for a reason that had
   * nothing to do with the code under test.
   */
  roamingSettings: (() => {
    return {
      get: vi.fn((key: string) => roamingStore.get(key)),
      set: vi.fn((key: string, value: unknown) => {
        roamingStore.set(key, value);
      }),
      remove: vi.fn((key: string) => {
        roamingStore.delete(key);
      }),
      saveAsync: vi.fn((cb?: (result: unknown) => void) => {
        if (cb) cb(undefined);
      }),
    };
  })(),
  InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
  BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
  InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
};

(globalThis as { Office?: unknown }).Office = officeMock;

// Keep storage access away from Node's experimental global getter. In Vitest's
// jsdom environment, `window` is an alias for the worker global and its
// `localStorage` property can still be Node's getter. The real jsdom window is
// available through `globalThis.jsdom`, so prefer that object when present.
function getJSDOMStorage(): Storage | null {
  const jsdomWindow = (globalThis as { jsdom?: { window?: Window } }).jsdom?.window;
  try {
    return jsdomWindow?.localStorage ?? null;
  } catch {
    return null;
  }
}

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function exposeStorage(storage: Storage): void {
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: storage,
    });
  } catch {
    // Some hosts expose a non-configurable storage property; continue with
    // the safe window reference when available.
  }

  if (typeof window !== "undefined" && window !== globalThis) {
    try {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        writable: true,
        value: storage,
      });
    } catch {
      // The host storage remains usable even if it cannot be replaced.
    }
  }
}

function installLocalStoragePolyfill(): void {
  const store = new Map<string, string>();
  const polyfill: Storage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length(): number {
      return store.size;
    },
  };
  exposeStorage(polyfill);
}

const jsdomStorage = getJSDOMStorage();
const browserStorage = jsdomStorage ?? getBrowserStorage();
if (browserStorage) {
  exposeStorage(browserStorage);
} else {
  installLocalStoragePolyfill();
}

// Mock fetch for LLM tests.
const { fetch: originalFetch } = globalThis;
globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/chat/completions")) {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"tone":"neutral","voice":"third-person"}' } }],
        model: "gpt-4o-mock",
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return originalFetch(input);
}) as typeof fetch;

// Ensure a clean document body between tests, even when a test file does not
// call cleanup() itself. This prevents DOM rendered by an earlier file from
// leaking into later files that use global queries.
afterEach(() => {
  if (typeof document !== "undefined" && document.body) {
    document.body.innerHTML = "";
  }
  // The `roamingSettings` mock persists for real, so a value one test saves is
  // visible to the next unless the store is reset. `loadState` prefers
  // roamingSettings over localStorage, so this is the leak a test sees even when
  // it clears `localStorage` in its own `beforeEach`.
  roamingStore.clear();
});
