/**
 * Debug logging for the consistency review flow.
 *
 * The 30-second timeout in the extraction and decision providers races the
 * LLM call against a timer. When a provider is slow but still streaming
 * tokens, the timeout fires even though the model is actively responding.
 * This logger captures what was sent and received at each call site so
 * the wiring can be verified.
 *
 * Gated on `DEBUG_CONSISTENCY` env var — off by default, no overhead
 * in production. Log entries are structured JSON via the shared logger
 * with redaction applied automatically.
 */

import { logger } from "../../shared/utils/logger";

const DEBUG_ENABLED =
  typeof process !== "undefined" &&
  (process.env?.DEBUG_CONSISTENCY === "1" || process.env?.DEBUG_CONSISTENCY === "true");

export function consistencyDebugLog(event: string, context: Record<string, unknown>): void {
  if (!DEBUG_ENABLED) return;
  logger.info(`[consistency:${event}]`, context);
}
