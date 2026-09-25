import { randomBytes, timingSafeEqual } from "node:crypto";

export const BROKER_PATH = "/__toneforge/llm/v1/chat/completions";
export const MAX_BROKER_BODY_BYTES = 1_000_000;

function isLoopbackHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

export function isLocalBrokerUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      isLoopbackHost(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function validateBrokerOrigin(headers = {}) {
  const origin = headers.origin;
  const host = headers.host;
  if (typeof origin !== "string" || typeof host !== "string" || origin === "null") {
    return { allowed: false, reason: "Origin must identify the local task-pane origin" };
  }
  try {
    const originUrl = new URL(origin);
    const hostUrl = new URL(`http://${host}`);
    if (
      !isLoopbackHost(originUrl.hostname) ||
      originUrl.host !== hostUrl.host ||
      (originUrl.protocol !== "http:" && originUrl.protocol !== "https:")
    ) {
      return { allowed: false, reason: "Origin is not a same-origin loopback request" };
    }
    return { allowed: true };
  } catch {
    return { allowed: false, reason: "Origin is not a valid local origin" };
  }
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function validateSessionNonce(headers = {}, expectedNonce = "") {
  const provided = headers["x-toneforge-session-nonce"];
  return Boolean(provided) && Boolean(expectedNonce) && constantTimeEqual(provided, expectedNonce);
}

export function validateBrokerPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, reason: "Request body must be a JSON object" };
  }
  if (typeof body.model !== "string" || body.model.trim().length === 0 || body.model.length > 200) {
    return {
      valid: false,
      reason: "Request model must be a non-empty string of at most 200 characters",
    };
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 100) {
    return { valid: false, reason: "Request messages must contain between 1 and 100 items" };
  }
  for (const message of body.messages) {
    if (
      !message ||
      typeof message !== "object" ||
      Array.isArray(message) ||
      typeof message.role !== "string" ||
      !["system", "user", "assistant", "tool"].includes(message.role) ||
      typeof message.content !== "string" ||
      message.content.length > 100_000
    ) {
      return { valid: false, reason: "Each request message has an invalid role or content" };
    }
  }
  return { valid: true };
}

export async function readJsonBody(req, maxBytes = MAX_BROKER_BODY_BYTES) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maxBytes) {
      throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
    }
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed;
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 });
  }
}

export function createLocalLlmBroker({
  fetchImpl = fetch,
  expectedNonce = randomBytes(32).toString("hex"),
  getApiKey = () => process.env.OPENAI_API_KEY,
  getUpstreamBase = () => process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
} = {}) {
  return async (req, res, next) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== BROKER_PATH) {
      next();
      return;
    }
    const origin = validateBrokerOrigin(req.headers ?? {});
    if (!origin.allowed && !validateSessionNonce(req.headers ?? {}, expectedNonce)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: origin.reason }));
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    const contentType = String(req.headers["content-type"] ?? "")
      .split(";", 1)[0]
      .trim();
    if (contentType.toLowerCase() !== "application/json") {
      res.statusCode = 415;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Content-Type must be application/json" }));
      return;
    }
    if (!getApiKey()) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Local LLM broker is not configured" }));
      return;
    }
    try {
      const body = await readJsonBody(req);
      const payload = validateBrokerPayload(body);
      if (!payload.valid) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: payload.reason }));
        return;
      }
      const upstream = await fetchImpl(`${getUpstreamBase().replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getApiKey()}`,
        },
        body: JSON.stringify(body),
      });
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      res.statusCode = error?.statusCode ?? 502;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error:
            error?.statusCode === 400 || error?.statusCode === 413
              ? error.message
              : "Local LLM broker request failed",
        }),
      );
    }
  };
}
