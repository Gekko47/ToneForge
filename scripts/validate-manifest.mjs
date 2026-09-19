/**
 * Manifest validation script.
 * Checks structural requirements beyond the official validator.
 *
 * This script validates the unified manifest v1.10 structure used by
 * ToneForge. It enforces that the manifest does not mix unified manifest
 * features (runtimes, commands) with XML-manifest-only features (ribbons,
 * extensions with XML-style entryPoints), and that all required fields are
 * present and correctly typed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const manifestPath = new URL("../manifest.json", import.meta.url);

function main() {
  const raw = readFileSync(manifestPath, "utf-8");
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    console.error("manifest.json is not valid JSON:", err.message);
    process.exit(1);
  }

  const errors = [];

  // manifestVersion is stored as a string in unified manifest (e.g. "1.10").
  const mv = manifest.manifestVersion;
  if (mv !== "1.10") {
    errors.push(`Expected manifestVersion "1.10", got ${mv}`);
  }
  if (manifest.host?.name !== "Word") {
    errors.push(`Expected host.name "Word", got ${manifest.host?.name}`);
  }
  if (!manifest.id || typeof manifest.id !== "string") {
    errors.push("Missing or invalid manifest.id");
  }
  if (!manifest.name?.short) {
    errors.push("Missing manifest.name.short");
  }
  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    errors.push("manifest.icons must be a non-empty array");
  }
  if (!Array.isArray(manifest.permissions)) {
    errors.push("manifest.permissions must be an array");
  }

  // Developer contact/support URLs must be strings, not booleans.
  const dev = manifest.developer ?? {};
  if (dev.contactUrl !== undefined && typeof dev.contactUrl !== "string") {
    errors.push(`developer.contactUrl must be a string, got ${typeof dev.contactUrl}`);
  }
  if (dev.supportUrl !== undefined && typeof dev.supportUrl !== "string") {
    errors.push(`developer.supportUrl must be a string, got ${typeof dev.supportUrl}`);
  }

  // Unified manifest v1.10 uses `extensions` with `entryPoints`, and defines
  // commands at the top level. XML-manifest-only features like `ribbons`
  // must not appear here, as they mix schema models.
  const extensions = manifest.extensions ?? [];
  for (const ext of extensions) {
    if (ext.ribbons !== undefined) {
      errors.push("manifest.extensions.ribbons is an XML-manifest-only feature; use top-level `commands` for unified manifest v1.10");
    }
    if (!ext.host) {
      errors.push("manifest.extensions[].host is required for unified manifest v1.10");
    }
    if (!ext.entryPoints || typeof ext.entryPoints !== "object") {
      errors.push("manifest.extensions[].entryPoints must be an object");
    }
  }

  // webApplicationInfo.id must be a GUID if present.
  const wai = manifest.webApplicationInfo;
  if (wai) {
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof wai.id !== "string" || !guidRegex.test(wai.id)) {
      errors.push(`webApplicationInfo.id must be a GUID, got ${wai.id}`);
    }
    if (typeof wai.resource !== "string") {
      errors.push("webApplicationInfo.resource must be a string");
    }
  }

  if (errors.length > 0) {
    console.error("Manifest validation failed:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log("Manifest validation passed.");
}

main();
