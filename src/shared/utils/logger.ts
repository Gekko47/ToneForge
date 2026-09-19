/**
 * Minimal structured logger that redacts sensitive fields.
 * Respects env.TELEMETRY_DISABLED.
 */

import { env } from "../../core/config/env";

interface LogContext {
  [key: string]: unknown;
}

function redactContext(context: LogContext): LogContext {
  const redacted: LogContext = {};
  for (const [k, v] of Object.entries(context)) {
    if (/key|token|secret|password|auth/i.test(k) && typeof v === "string") {
      redacted[k] = "***";
    } else {
      redacted[k] = v;
    }
  }
  return redacted;
}

function base(level: "info" | "warn" | "error", message: string, context: LogContext = {}): void {
  if (env.TELEMETRY_DISABLED && level === "info") return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...redactContext(context),
  };
  // eslint-disable-next-line no-console
  console[level](JSON.stringify(entry));
}

export const logger = {
  info: (message: string, context?: LogContext) => base("info", message, context),
  warn: (message: string, context?: LogContext) => base("warn", message, context),
  error: (message: string, context?: LogContext) => base("error", message, context),
};
