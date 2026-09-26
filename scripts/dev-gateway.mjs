/**
 * Development-only OpenRouter gateway stand-in (Phase 4).
 *
 * NOT a production credential service. The production authentication/broker
 * service is a Phase 6 deliverable and is currently held. This module exists so
 * the OpenRouter provider option can be exercised end-to-end during local
 * development without a user API key ever entering the browser bundle, browser
 * state, a URL, or a log line.
 *
 * The trust model is unchanged from the existing local broker: every route
 * requires a loopback same-origin request or the per-session nonce, the key
 * lives only in this Node process's memory, and only an opaque connection
 * reference travels back to the add-in.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  MAX_BROKER_BODY_BYTES,
  readJsonBody,
  validateBrokerOrigin,
  validateSessionNonce,
} from "./dev-broker.mjs";

/** The official OpenRouter API base, used as the pre-filled default. */
export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export const GATEWAY_PATH_PREFIX = "/__toneforge/gateway/v1";

/** Loopback origins are permitted so a locally proxied OpenRouter can be tested. */
function isLoopbackHostname(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

/**
 * Validate an upstream base URL against deployment policy.
 *
 * A syntactically valid URL is not trusted. The official OpenRouter origin is
 * allowed by default; any other origin is classified as a self-hosted endpoint
 * the caller must explicitly approve, and a plaintext or credential-bearing URL
 * is refused outright.
 */
export function classifyUpstreamBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "" || url.hash !== "") return null;

  const origin = url.origin;
  const normalized = `${origin}${url.pathname.replace(/\/$/, "")}`;
  if (origin === "https://openrouter.ai") {
    return { baseUrl: normalized, classification: "deploymentDefault" };
  }
  if (isLoopbackHostname(url.hostname)) {
    return { baseUrl: normalized, classification: "loopbackDevelopment" };
  }
  // Some other HTTPS origin. It is permitted only when the caller declares it
  // an approved self-hosted endpoint; the browser never chooses silently.
  return { baseUrl: normalized, classification: "userApprovedSelfHosted" };
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Create the development gateway middleware.
 *
 * `connections` is injected so tests can inspect what was retained; production
 * would hold this in an encrypted, tenant-scoped store instead.
 */
export function createDevGatewayBroker({
  fetchImpl = fetch,
  expectedNonce = randomBytes(32).toString("hex"),
  connections = new Map(),
  now = () => new Date(),
} = {}) {
  const newConnectionId = () => `or_${randomBytes(16).toString("hex")}`;

  return async (req, res, next) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!pathname.startsWith(GATEWAY_PATH_PREFIX)) {
      next();
      return;
    }

    // Every gateway route is behind the same loopback/origin or nonce guard as
    // the existing LLM broker. A route that forgot this check would be a
    // credential-forwarding hole.
    const origin = validateBrokerOrigin(req.headers ?? {});
    if (!origin.allowed && !validateSessionNonce(req.headers ?? {}, expectedNonce)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      // The guard's reason is fixed text; request headers are never echoed.
      res.end(JSON.stringify({ error: origin.reason }));
      return;
    }

    const route = pathname.slice(GATEWAY_PATH_PREFIX.length) || "/";
    const segments = route.split("/").filter(Boolean);

    try {
      if (route === "/connections/api-key" && req.method === "POST") {
        await handleApiKey(req, res);
        return;
      }
      if (segments[0] === "connections" && segments.length >= 2) {
        const connectionId = decodeURIComponent(segments[1]);
        if (segments[2] === "models" && segments.length === 3 && req.method === "GET") {
          await handleModels(connectionId, res);
          return;
        }
        if (
          segments[2] === "chat" &&
          segments[3] === "completions" &&
          segments.length === 4 &&
          req.method === "POST"
        ) {
          await handleChatCompletions(connectionId, req, res);
          return;
        }
        if (segments.length === 2 && req.method === "DELETE") {
          // Drop the key whether or not it existed, so a retry cannot leave a
          // usable credential in the process.
          connections.delete(connectionId);
          res.statusCode = 204;
          res.end();
          return;
        }
      }
      sendJson(res, 404, { error: "Unknown gateway route" });
    } catch (error) {
      const status = error?.statusCode ?? 502;
      // The error message is a fixed, non-secret string. The upstream body is
      // deliberately not surfaced, because it can echo the request.
      sendJson(res, status, {
        error:
          status === 413
            ? "Request body too large"
            : status === 400
              ? error.message
              : "Development gateway request failed",
      });
    }

    async function handleApiKey(request, response) {
      if (!isJsonContentType(request.headers)) {
        sendJson(response, 415, { error: "Content-Type must be application/json" });
        return;
      }
      const body = await readJsonBody(request);
      if (body?.provider !== "openrouter") {
        sendJson(response, 400, { error: "Unsupported provider for an API-key connection" });
        return;
      }
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      if (apiKey.length === 0) {
        sendJson(response, 400, { error: "An API key is required" });
        return;
      }
      const classified = classifyUpstreamBaseUrl(body.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL);
      if (!classified) {
        sendJson(response, 400, { error: "Base URL must be an HTTPS origin without credentials" });
        return;
      }
      // A self-hosted origin is only honoured when the caller explicitly said so.
      if (
        classified.classification === "userApprovedSelfHosted" &&
        body.approveSelfHosted !== true
      ) {
        sendJson(response, 403, { error: "This base URL requires explicit self-hosted approval" });
        return;
      }

      const connectionId = newConnectionId();
      connections.set(connectionId, { apiKey, ...classified, createdAt: now().toISOString() });

      // The response carries only non-secret metadata. The key is not echoed.
      sendJson(response, 200, {
        connectionId,
        provider: "openrouter",
        authMode: "brokerApiKey",
        status: "connected",
        baseOrigin: { origin: classified.baseUrl, classification: classified.classification },
      });
    }

    async function handleModels(connectionId, response) {
      const connection = connections.get(connectionId);
      if (!connection) {
        sendJson(response, 404, { error: "Unknown connection" });
        return;
      }
      const upstream = await fetchImpl(`${connection.baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${connection.apiKey}`,
          // OpenRouter attributes requests to a site; the add-in does not need
          // to identify itself beyond that.
          "HTTP-Referer": "https://github.com/Gekko47/ToneForge",
          "X-Title": "ToneForge",
        },
      });
      if (!upstream.ok) {
        sendJson(response, upstream.status, { error: "Model list request failed" });
        return;
      }
      const payload = await upstream.json();
      // The raw provider list is passed through for the client-side pure
      // normalizer; the broker adds no interpretation of its own.
      sendJson(response, 200, {
        connectionId,
        fetchedAt: now().toISOString(),
        data: payload?.data ?? [],
      });
    }

    async function handleChatCompletions(connectionId, request, response) {
      const connection = connections.get(connectionId);
      if (!connection) {
        sendJson(response, 404, { error: "Unknown connection" });
        return;
      }
      if (!isJsonContentType(request.headers)) {
        sendJson(response, 415, { error: "Content-Type must be application/json" });
        return;
      }
      const body = await readJsonBody(request);
      const payload = validateChatPayload(body);
      if (!payload.valid) {
        sendJson(response, 400, { error: payload.reason });
        return;
      }
      const upstream = await fetchImpl(`${connection.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${connection.apiKey}`,
          "HTTP-Referer": "https://github.com/Gekko47/ToneForge",
          "X-Title": "ToneForge",
        },
        body: JSON.stringify(body),
      });
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
      res.end(Buffer.from(await upstream.arrayBuffer()));
    }
  };
}

function isJsonContentType(headers) {
  const value = String(headers?.["content-type"] ?? "")
    .split(";", 1)[0]
    .trim();
  return value.toLowerCase() === "application/json";
}

/** Reuse the bounded chat-completion schema shape the existing broker enforces. */
export function validateChatPayload(body) {
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

export { MAX_BROKER_BODY_BYTES, timingSafeEqual };
