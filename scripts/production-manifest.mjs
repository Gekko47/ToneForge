/**
 * Production manifest generation (Phase 4).
 *
 * The checked-in `manifest.json` and `manifest.xml` point at
 * `https://localhost:3000` because that is what `npm run sideload` needs, and
 * they must keep pointing there. A production manifest is therefore *derived*,
 * never hand-edited: take the development manifest, substitute the deployment
 * origin, and prove the result contains nothing development-shaped.
 *
 * The rejections are the point. A production manifest that still names
 * `localhost`, still carries a development-broker path, or has a credential
 * baked into an origin would ship an add-in that phones home to a developer's
 * machine or leaks a secret to every user. Each of those is refused by name so
 * the failure says which rule was broken.
 */

/** Hostnames that can never appear in a production manifest. */
export const LOOPBACK_HOSTNAMES = Object.freeze([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
  "::",
]);

/**
 * Path prefixes owned by the local development broker. A production add-in
 * pointing at one of these would be calling the developer's machine.
 */
export const DEVELOPMENT_PATH_PREFIXES = Object.freeze([
  "/__toneforge/llm",
  "/__toneforge/gateway",
  "/__toneforge",
]);

/**
 * Value shapes that look like credentials.
 *
 * A manifest is public configuration. Any value matching one of these is a
 * mistake regardless of where it appears, so the check walks every string in
 * the document rather than only the URL fields.
 */
export const SECRET_SHAPED_PATTERNS = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\bpk-[A-Za-z0-9_-]{12,}/,
  /\brk-[A-Za-z0-9_-]{12,}/,
  /\bwhsec_[A-Za-z0-9_-]{12,}/,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /[?&](api[-_]?key|key|token|access[-_]?token|secret)=[^&\s]+/i,
]);

/**
 * Validate the deployment origin a production manifest will be built on.
 *
 * Returns a list of problems rather than throwing, so a caller can report all
 * of them at once instead of making a user fix them one at a time.
 */
export function validateProductionOrigin(value) {
  const problems = [];
  if (typeof value !== "string" || value.trim().length === 0) {
    return ["Production origin is required."];
  }
  const trimmed = value.trim();
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return ["Production origin is not a valid URL."];
  }
  if (url.protocol !== "https:") {
    problems.push("Production origin must use HTTPS.");
  }
  if (url.username !== "" || url.password !== "") {
    problems.push("Production origin must not contain credentials.");
  }
  if (url.search !== "" || url.hash !== "") {
    problems.push("Production origin must not contain a query or fragment.");
  }
  const hostname = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTNAMES.includes(hostname)) {
    problems.push(`Production origin must not be a loopback address (${hostname}).`);
  }
  if (hostname.endsWith(".local") || hostname.endsWith(".localhost")) {
    problems.push("Production origin must not be a local-network hostname.");
  }
  if (hostname === "0.0.0.0" || /^127\./.test(hostname) || /^10\./.test(hostname)) {
    problems.push("Production origin must not be a private or loopback address.");
  }
  if (hostname.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
    problems.push("Production origin must not be a private-network address.");
  }
  // Link-local (169.254/16) reaches only the local segment, and the IPv6 forms
  // below are the same addresses written so that a naive IPv4 prefix test would
  // miss them: ULA fc00::/7, link-local fe80::/10, and IPv4-mapped ::ffff:a.b.c.d.
  if (
    /^169\.254\./.test(hostname) ||
    /^\[f[cd][0-9a-f]{2}:/.test(hostname) ||
    /^\[fe[89ab][0-9a-f]:/.test(hostname) ||
    /^\[::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}\]$/.test(hostname)
  ) {
    problems.push("Production origin must not be a private-network address.");
  }
  if (url.port !== "" && url.port !== "443") {
    problems.push(`Production origin must not pin a non-standard port (${url.port}).`);
  }
  for (const pattern of SECRET_SHAPED_PATTERNS) {
    if (pattern.test(trimmed)) {
      problems.push("Production origin looks like it contains a credential.");
      break;
    }
  }
  return problems;
}

/** Walk every string value in a JSON-like structure. */
function* stringValues(node) {
  if (typeof node === "string") {
    yield node;
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) yield* stringValues(item);
    return;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node)) yield* stringValues(value);
  }
}

/**
 * Every development-shaped string still present in a manifest.
 *
 * Reported as a list of `{ path, value, reason }` so a failure names the exact
 * field rather than just saying the manifest is invalid.
 */
export function findDevelopmentArtifacts(manifest) {
  const found = [];
  const visit = (node, path) => {
    if (typeof node === "string") {
      const lower = node.toLowerCase();
      if (/^http:\/\//.test(lower)) {
        found.push({ path, value: node, reason: "plaintext HTTP origin" });
        return;
      }
      for (const hostname of LOOPBACK_HOSTNAMES) {
        if (lower.includes(`//${hostname}`) || lower.includes(`//${hostname}:`)) {
          found.push({ path, value: node, reason: `loopback address ${hostname}` });
          return;
        }
      }
      for (const prefix of DEVELOPMENT_PATH_PREFIXES) {
        if (lower.includes(prefix)) {
          found.push({ path, value: node, reason: `development broker path ${prefix}` });
          return;
        }
      }
      for (const pattern of SECRET_SHAPED_PATTERNS) {
        if (pattern.test(node)) {
          found.push({ path, value: "<redacted>", reason: "credential-shaped value" });
          return;
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        visit(value, path.length === 0 ? key : `${path}.${key}`);
      }
    }
  };
  visit(manifest, "");
  return found;
}

/**
 * Rewrite every development origin in a manifest to the production origin.
 *
 * Pure, so the substitution is testable without writing anything. Path and
 * query are preserved: only the scheme, host, and port change, because the
 * production deployment serves the same pages at the same paths.
 */
export function buildProductionManifest(sourceManifest, productionOrigin) {
  const problems = validateProductionOrigin(productionOrigin);
  if (problems.length > 0) {
    throw new Error(`Refusing to build a production manifest: ${problems.join(" ")}`);
  }
  const origin = new URL(productionOrigin.trim()).origin;
  const source = sourceManifest.validDomains?.[0];
  if (typeof source !== "string" || source.length === 0) {
    throw new Error("Development manifest has no validDomains[0] to substitute.");
  }
  const replace = (node) => {
    if (typeof node === "string") {
      return node.split(source).join(origin);
    }
    if (Array.isArray(node)) return node.map(replace);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, replace(value)]));
    }
    return node;
  };
  const result = replace(sourceManifest);
  const remaining = findDevelopmentArtifacts(result);
  if (remaining.length > 0) {
    const detail = remaining.map((item) => `${item.path} (${item.reason})`).join(", ");
    throw new Error(`Production manifest still contains development values: ${detail}`);
  }
  return result;
}
