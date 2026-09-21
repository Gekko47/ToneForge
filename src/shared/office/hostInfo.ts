/**
 * Cached Office host identity.
 *
 * The authoritative host name/platform comes from the `Office.onReady(info)`
 * callback payload. `Word.RequestContext` does not reliably carry host
 * identity in the real host, and `Office.context.host` is not populated the
 * way our local type declarations assume — so the startup path caches the
 * `onReady` info here, and the probe/diagnostics read it back.
 *
 * Lives in `shared/office` so both `taskpane/officeInit` (writer) and
 * `word/capabilityProbe` (reader) can use it without crossing the
 * `word/ must not depend on ui` boundary (see ADR-0013).
 */

export interface OfficeHostInfo {
  host: string | null;
  platform: string | null;
}

let cachedHostInfo: OfficeHostInfo | null = null;

export function setCachedHostInfo(info: OfficeHostInfo | null): void {
  cachedHostInfo = info;
}

export function getCachedHostInfo(): OfficeHostInfo | null {
  return cachedHostInfo;
}
