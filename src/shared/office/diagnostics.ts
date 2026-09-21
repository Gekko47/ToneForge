/**
 * Non-destructive runtime diagnostics for the Office/Word host.
 *
 * This module inspects the global `Office` and `Word` objects without
 * mutating the user's document. It is intended to be triggered from the
 * taskpane (or a debug URL) to help identify why the taskpane is blank.
 *
 * All probes are read-only and safe to call outside a Word host.
 */

import { getCachedHostInfo } from "./hostInfo";

export interface OfficeDiagnostics {
  officeGlobal: boolean;
  officeGlobalType: string;
  userAgent: string | null;
  onReady: boolean;
  initialize: boolean;
  run: boolean;
  context: boolean;
  host: boolean;
  hostName: string | null;
  hostVersion: string | null;
  onReadyHost: string | null;
  onReadyPlatform: string | null;
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
    userAgent: null,
    onReady: false,
    initialize: false,
    run: false,
    context: false,
    host: false,
    hostName: null,
    hostVersion: null,
    onReadyHost: null,
    onReadyPlatform: null,
    roamingSettings: false,
    insertBreakBehavior: false,
    wordGlobal: false,
    wordRun: false,
    wordInsertLocation: false,
    errors,
  };

  // --- Cached onReady host identity ---
  // The authoritative host name comes from the `Office.onReady(info)` payload
  // captured at startup, not from `Office.context.host` (which the real host
  // does not populate as an object with name/version).
  try {
    const cached = getCachedHostInfo();
    if (cached) {
      result.onReadyHost = cached.host;
      result.onReadyPlatform = cached.platform;
    }
  } catch {
    // Non-fatal: cached host info is best-effort diagnostics only.
  }

  // --- Environment context ---
  try {
    result.userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null;
  } catch (err) {
    errors.push(`navigator probe threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- Office global ---
  try {
    const office = (globalThis as unknown as { Office?: unknown }).Office;
    result.officeGlobal = typeof office !== "undefined";
    result.officeGlobalType = typeof office;
    if (!office) {
      errors.push("Office global is undefined — add-in is not running inside Word.");
      // Keep probing: report the environment so we can distinguish
      // "loaded in a plain browser" from "loaded in Word but Office.js
      // failed to inject".
      result.wordGlobal = typeof (globalThis as unknown as { Word?: unknown }).Word !== "undefined";
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
  lines.push(`User agent: ${d.userAgent ?? "(null)"}`);
  lines.push(`Office global present: ${d.officeGlobal} (type: ${d.officeGlobalType})`);
  lines.push(`Office.onReady: ${d.onReady}`);
  lines.push(`Office.initialize: ${d.initialize}`);
  lines.push(`Office.run: ${d.run}`);
  lines.push(`Office.context present: ${d.context}`);
  lines.push(`Office.context.host present: ${d.host}`);
  lines.push(`Host name: ${d.hostName ?? "(null)"}`);
  lines.push(`Host version: ${d.hostVersion ?? "(null)"}`);
  lines.push(`onReady host: ${d.onReadyHost ?? "(null)"}`);
  lines.push(`onReady platform: ${d.onReadyPlatform ?? "(null)"}`);
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
