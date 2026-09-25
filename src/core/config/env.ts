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
  TELEMETRY_DISABLED: z.coerce.boolean().default(true),
  ANALYTICS_ENDPOINT: optionalUrl,
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
    TELEMETRY_DISABLED: process.env.TELEMETRY_DISABLED,
    ANALYTICS_ENDPOINT: process.env.ANALYTICS_ENDPOINT,
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
