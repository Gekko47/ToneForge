import { vi } from "vitest";

// Provide a minimal Office global so shared/word modules can be imported in tests.
const officeMock = {
  run: <T>(func: (context: unknown) => Promise<T>): Promise<T> =>
    func({
      document: {
        body: {
          text: "",
          load: vi.fn(),
          paragraphs: { load: vi.fn(), items: [] },
          getRange: vi.fn(() => ({
            text: "",
            insertText: vi.fn(),
            insertBreak: vi.fn(),
            insertParagraph: vi.fn(() => ({ format: {}, load: vi.fn() })),
            paragraphs: { load: vi.fn(), items: [] },
            font: { name: "", size: 0, color: "", load: vi.fn() },
            load: vi.fn(),
          })),
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
  roamingSettings: {
    get: vi.fn(),
    set: vi.fn(),
    saveAsync: vi.fn((cb?: (result: unknown) => void) => {
      if (cb) cb(undefined);
    }),
  },
  InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
};

(globalThis as { Office?: unknown }).Office = officeMock;

// localStorage polyfill for environments where it is not available.
if (typeof localStorage === "undefined") {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
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
    key: (_i: number) => null,
    length: 0,
  } as unknown as Storage;
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
