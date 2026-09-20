/**
 * Non-destructive runtime diagnostics for the Office/Word host.
 *
 * This module inspects the global `Office` and `Word` objects without
 * mutating the user's document. It is intended to be triggered from the
 * taskpane (or a debug URL) to help identify why the taskpane is blank.
 *
 * All probes are read-only and safe to call outside a Word host.
 */

export interface OfficeDiagnostics {
  officeGlobal: boolean;
  officeGlobalType: string;
  onReady: boolean;
  initialize: boolean;
  run: boolean;
  context: boolean;
  host: boolean;
  hostName: string | null;
  hostVersion: string | null;
  roamingSettings: boolean;
  insertBreakBehavior: boolean;
  wordGlobal: boolean;
  wordRun: boolean;
  wordInsertLocation: boolean;
  errors: string[];
}

/**
 * Probe the Office/Word runtime state.
 * Safe to call outside a Word host — every probe is wrapped in try/catch.
 */
export function probeOfficeRuntime(): OfficeDiagnostics {
  const errors: string[] = [];
  const result: OfficeDiagnostics = {
    officeGlobal: false,
    officeGlobalType: "undefined",
    onReady: false,
    initialize: false,
    run: false,
    context: false,
    host: false,
    hostName: null,
    hostVersion: null,
    roamingSettings: false,
    insertBreakBehavior: false,
    wordGlobal: false,
    wordRun: false,
    wordInsertLocation: false,
    errors,
  };

  // --- Office global ---
  try {
    const office = (globalThis as unknown as { Office?: unknown }).Office;
    result.officeGlobal = typeof office !== "undefined";
    result.officeGlobalType = typeof office;
    if (!office) {
      errors.push("Office global is undefined — add-in is not running inside Word.");
      return result;
    }
  } catch (err) {
    errors.push(`Office global probe threw: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  // --- Office.onReady ---
  try {
    const office = (globalThis as unknown as { Office?: Record<string, unknown> }).Office as
      Record<string, unknown> | undefined;
    result.onReady = typeof office?.onReady === "function";
    result.initialize = typeof office?.initialize === "function";
    result.run = typeof office?.run === "function";
    result.context = typeof office?.context !== "undefined";
    result.roamingSettings = typeof office?.roamingSettings !== "undefined";
    result.insertBreakBehavior = typeof office?.InsertBreakBehavior !== "undefined";
  } catch (err) {
    errors.push(`Office property probe threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- Office.context.host ---
  try {
    const office = (
      globalThis as unknown as {
        Office?: { context?: { host?: { name?: unknown; version?: unknown } } };
      }
    ).Office;
    const host = office?.context?.host;
    if (host && typeof host === "object") {
      result.host = true;
      result.hostName = typeof host.name === "string" ? host.name : null;
      result.hostVersion = typeof host.version === "string" ? host.version : null;
    }
  } catch (err) {
    errors.push(
      `Office.context.host probe threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Word global ---
  try {
    const word = (globalThis as unknown as { Word?: unknown }).Word;
    result.wordGlobal = typeof word !== "undefined";
    if (word && typeof word === "object") {
      const w = word as Record<string, unknown>;
      result.wordRun = typeof w.run === "function";
      result.wordInsertLocation = typeof w.InsertLocation !== "undefined";
    }
  } catch (err) {
    errors.push(`Word global probe threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Format diagnostics as a human-readable string for console logging.
 */
export function formatDiagnostics(d: OfficeDiagnostics): string {
  const lines: string[] = [];
  lines.push("=== Office/Word runtime diagnostics ===");
  lines.push(`Office global present: ${d.officeGlobal} (type: ${d.officeGlobalType})`);
  lines.push(`Office.onReady: ${d.onReady}`);
  lines.push(`Office.initialize: ${d.initialize}`);
  lines.push(`Office.run: ${d.run}`);
  lines.push(`Office.context present: ${d.context}`);
  lines.push(`Office.context.host present: ${d.host}`);
  lines.push(`Host name: ${d.hostName ?? "(null)"}`);
  lines.push(`Host version: ${d.hostVersion ?? "(null)"}`);
  lines.push(`Office.roamingSettings present: ${d.roamingSettings}`);
  lines.push(`Office.InsertBreakBehavior present: ${d.insertBreakBehavior}`);
  lines.push(`Word global present: ${d.wordGlobal}`);
  lines.push(`Word.run: ${d.wordRun}`);
  lines.push(`Word.InsertLocation: ${d.wordInsertLocation}`);
  if (d.errors.length > 0) {
    lines.push("--- Errors ---");
    for (const e of d.errors) lines.push(e);
  }
  lines.push("=== End diagnostics ===");
  return lines.join("\n");
}
