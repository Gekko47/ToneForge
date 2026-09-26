/**
 * Minimal structured logger that redacts sensitive fields.
 * Respects env.TELEMETRY_DISABLED.
 */

import { env } from "../../core/config/env";
import { redactDiagnosticContext, redactSensitiveText } from "./redaction";

interface LogContext {
  [key: string]: unknown;
}

function base(level: "info" | "warn" | "error", message: string, context: LogContext = {}): void {
  if (env.TELEMETRY_DISABLED && level === "info") return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    message: redactSensitiveText(message),
    ...redactDiagnosticContext(context),
  };
  // eslint-disable-next-line no-console
  console[level](JSON.stringify(entry));
}

export const logger = {
  info: (message: string, context?: LogContext) => base("info", message, context),
  warn: (message: string, context?: LogContext) => base("warn", message, context),
  error: (message: string, context?: LogContext) => base("error", message, context),
};

interface HostErrorLike {
  name?: unknown;
  code?: unknown;
  message?: unknown;
}

/**
 * Turn a thrown value into a log context whose fields survive redaction.
 *
 * A bare `{ error: err }` context is not useful: the `error` key matches the
 * content rule and is replaced wholesale, so a Word host failure logged that way
 * reads as `[REDACTED_CONTENT]` and the cause is never recoverable. The three
 * fields returned here are the allowlisted diagnostic keys — they keep the
 * error name, any Office error code, and the message, while still passing
 * through credential redaction and a length cap.
 */
export function describeError(error: unknown): LogContext {
  if (typeof error === "string") return { errorMessage: error };
  if (error instanceof Error || (typeof error === "object" && error !== null)) {
    const candidate = error as HostErrorLike;
    const context: LogContext = {
      errorName: typeof candidate.name === "string" ? candidate.name : "Error",
      errorMessage: typeof candidate.message === "string" ? candidate.message : String(error),
    };
    // Office.js rejects with a numeric or string `code`; without it a
    // `GeneralException` is indistinguishable from any other general failure.
    if (candidate.code !== undefined && candidate.code !== null && candidate.code !== "") {
      context.errorCode =
        typeof candidate.code === "number" ? candidate.code : String(candidate.code);
    }
    return context;
  }
  return { errorMessage: String(error) };
}
