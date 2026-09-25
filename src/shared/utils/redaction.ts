const REDACT_PATTERNS: readonly { regex: RegExp; replacement: string }[] = [
  {
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: "[REDACTED_EMAIL]",
  },
  { regex: /\b(?:\d[ -]*?){13,16}\b/g, replacement: "[REDACTED_CARD]" },
  { regex: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}\b/g, replacement: "[REDACTED_API_KEY]" },
  { regex: /\bwhsec[_-][A-Za-z0-9_-]{6,}\b/g, replacement: "[REDACTED_API_KEY]" },
  { regex: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, replacement: "Bearer [REDACTED_TOKEN]" },
  { regex: /\b[A-Fa-f0-9]{32,}\b/g, replacement: "[REDACTED_SECRET]" },
  { regex: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, replacement: "[REDACTED_SECRET]" },
];

/** Redact common credential and personal-data shapes from untrusted text. */
export function redactSensitiveText(text: string): string {
  return REDACT_PATTERNS.reduce(
    (redacted, { regex, replacement }) => redacted.replace(regex, replacement),
    text,
  );
}

const SENSITIVE_FIELD = /key|token|secret|password|auth|credential|cookie|header/i;
const PROMPT_OR_TEXT_FIELD =
  /prompt|instruction|document|content|text|message|evidence|actual|expected|error|reason/i;

function redactValue(key: string, value: unknown, seen: WeakSet<object>): unknown {
  if (SENSITIVE_FIELD.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return PROMPT_OR_TEXT_FIELD.test(key) ? "[REDACTED_CONTENT]" : redactSensitiveText(value);
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(key, item, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[REDACTED_CYCLE]";
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactValue(childKey, childValue, seen),
      ]),
    );
  }
  return value;
}

/** Recursively remove credentials and document/prompt content from diagnostic context. */
export function redactDiagnosticContext(context: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, redactValue(key, value, new WeakSet())]),
  );
}
