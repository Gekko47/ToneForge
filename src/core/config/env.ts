/**
 * Centralized, typed browser configuration.
 *
 * This contract intentionally excludes API keys and every other secret.
 * Webpack may define only the allowlisted values below. Development secrets
 * are consumed exclusively by the Node-side local broker.
 */

import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);
const brokerUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .refine((value) => {
      if (value.startsWith("/")) return !value.startsWith("//");
      try {
        const url = new URL(value);
        return (
          (url.protocol === "http:" || url.protocol === "https:") &&
          ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname) &&
          url.username === "" &&
          url.password === "" &&
          url.hash === ""
        );
      } catch {
        return false;
      }
    }, "Must be a same-origin path or an HTTP(S) loopback URL")
    .optional(),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HTTPS_PORT: z.coerce.number().default(3001),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  LLM_BROKER_URL: brokerUrl,
  OPENAI_TIMEOUT_MS: z.coerce.number().default(30000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().default(2),
  /**
   * The whole provider stage's budget for one semantic review, retries included.
   *
   * Separate from `OPENAI_TIMEOUT_MS`, which bounds a single request. This bounds
   * the stage around one or more requests, so it must stay above the per-request
   * deadline — a value below it would cut off an attempt that was still allowed to
   * run. A slow model needs both raised together, this one first.
   */
  SEMANTIC_STAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(90000),
  /**
   * The most tokens one semantic review may generate.
   *
   * A review is a bounded object — an assessment, at most one revision of the
   * selection, and five flags — so an unbounded completion buys nothing but time. A
   * live run produced about 38 KB (roughly 9.5k tokens) for an 882-character
   * selection, and took 83-96 seconds to do it. Raise this if a long selection is
   * truncated, which appears as an unreadable response.
   */
  SEMANTIC_REVIEW_MAX_TOKENS: z.coerce.number().int().positive().default(3000),
  TELEMETRY_DISABLED: z.coerce.boolean().default(true),
  ANALYTICS_ENDPOINT: optionalUrl,
  /**
   * Whether the Anthropic end-user OAuth flow is enabled.
   *
   * Off by default, and deliberately a deployment switch rather than a user
   * setting. The state machine for it exists and is tested, but there is no
   * production gateway to complete the exchange against, so offering a sign-in
   * button that cannot finish would be a connection flow that does not exist
   * (ADR-0060).
   */
  ANTHROPIC_OAUTH_ENABLED: z.coerce.boolean().default(false),
  /**
   * Enables debug logging for the consistency review flow.
   *
   * Off by default. When set to "1" or "true", the extraction and decision
   * providers log what was sent and received at each call site, so a timeout
   * can be diagnosed as a wiring problem or a genuinely slow provider.
   *
   * Parsed as an exact string match (only "1" or "true" enable it) rather
   * than coerced boolean, consistent with the reader in debugLog.ts.
   */
  DEBUG_CONSISTENCY: z
    .string()
    .refine(
      (value) => value === "1" || value === "true" || value === "0" || value === "false",
      'Must be "1", "true", "0", or "false"',
    )
    .optional()
    .default("false")
    .transform((value) => value === "1" || value === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    HTTPS_PORT: process.env.HTTPS_PORT,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    LLM_BROKER_URL: process.env.LLM_BROKER_URL,
    OPENAI_TIMEOUT_MS: process.env.OPENAI_TIMEOUT_MS,
    OPENAI_MAX_RETRIES: process.env.OPENAI_MAX_RETRIES,
    SEMANTIC_STAGE_TIMEOUT_MS: process.env.SEMANTIC_STAGE_TIMEOUT_MS,
    SEMANTIC_REVIEW_MAX_TOKENS: process.env.SEMANTIC_REVIEW_MAX_TOKENS,
    TELEMETRY_DISABLED: process.env.TELEMETRY_DISABLED,
    ANALYTICS_ENDPOINT: process.env.ANALYTICS_ENDPOINT,
    ANTHROPIC_OAUTH_ENABLED: process.env.ANTHROPIC_OAUTH_ENABLED,
    DEBUG_CONSISTENCY: process.env.DEBUG_CONSISTENCY,
  });
  if (!parsed.success) {
    // Surface a single, actionable error instead of a wall of Zod noise.
    const flat = parsed.error.flatten();
    const message = Object.entries(flat.fieldErrors)
      .map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export { redactSensitiveText } from "../../shared/utils/redaction";
