/**
 * Centralized, typed environment configuration.
 * Keys are redacted in logs. Never read process.env directly elsewhere.
 */

import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HTTPS_PORT: z.coerce.number().default(3001),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_TIMEOUT_MS: z.coerce.number().default(30000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().default(2),
  TELEMETRY_DISABLED: z.coerce.boolean().default(true),
  ANALYTICS_ENDPOINT: optionalUrl,
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
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

export function redact(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}
