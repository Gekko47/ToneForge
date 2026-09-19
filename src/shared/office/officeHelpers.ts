/**
 * Thin wrappers around Office.js runtime detection.
 * The actual document access lives in `word/documentReader` so this file
 * stays dependency-free for unit testing.
 *
 * `runInWord` is typed against `Office.Context` (the shared request-context
 * type). Callers that need the Word-specific `Word.RequestContext` should
 * narrow the parameter inside their `runInWord` callback.
 */

type OfficeGlobal = {
  Office?: {
    Context?: Office.Context;
    run: <R>(func: (context: Office.Context) => Promise<R>) => Promise<R>;
    roamingSettings?: {
      get: (key: string) => unknown;
      set: (key: string, value: unknown) => void;
      saveAsync?: (callback?: (result: unknown) => void) => void;
    };
  };
};

function getOffice(): OfficeGlobal["Office"] {
  return (globalThis as unknown as OfficeGlobal).Office;
}

export function isOfficeReady(): boolean {
  return typeof getOffice() !== "undefined";
}

export function ensureOfficeReady(): void {
  if (!isOfficeReady()) {
    throw new Error("Office.js runtime is not available. Run this add-in inside Word.");
  }
}

export async function runInWord<T>(func: (context: Office.Context) => Promise<T>): Promise<T> {
  ensureOfficeReady();
  const office = getOffice();
  if (!office?.run) throw new Error("Office.run is not available");
  return office.run(func);
}

export function context(): Office.Context | null {
  return getOffice()?.Context ?? null;
}
