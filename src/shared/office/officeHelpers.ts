/**
 * Thin wrappers around Office.js runtime detection.
 * The actual document access lives in `word/documentReader` so this file
 * stays dependency-free for unit testing.
 *
 * `runInWord` is typed against `Office.Context` (the shared request-context
 * type). Callers that need the Word-specific `Word.RequestContext` should
 * narrow the parameter inside their `runInWord` callback.
 *
 * Word document access must go through `Word.run`, not `Office.run`. The
 * real Word host exposes `Word.run`; `Office.run` does not exist in the
 * production runtime (it only existed in our old test doubles).
 */

type HostGlobals = {
  Office?: {
    Context?: Office.Context;
    // Legacy test doubles expose `run` on `Office`. The real Word host does
    // not; production code must prefer `Word.run` below.
    run?: <R>(func: (context: Office.Context) => Promise<R>) => Promise<R>;
    roamingSettings?: {
      get: (key: string) => unknown;
      set: (key: string, value: unknown) => void;
      saveAsync?: (callback?: (result: unknown) => void) => void;
    };
  };
  Word?: {
    run: <R>(func: (context: Office.Context) => Promise<R>) => Promise<R>;
  };
};

function getOffice(): HostGlobals["Office"] {
  return (globalThis as unknown as HostGlobals).Office;
}

function getWord(): HostGlobals["Word"] {
  return (globalThis as unknown as HostGlobals).Word;
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
  const wordRun = getWord()?.run;
  if (typeof wordRun === "function") return wordRun(func);
  const officeRun = getOffice()?.run;
  if (typeof officeRun === "function") return officeRun(func);
  throw new Error("Word.run is not available");
}

export function context(): Office.Context | null {
  return getOffice()?.Context ?? null;
}
