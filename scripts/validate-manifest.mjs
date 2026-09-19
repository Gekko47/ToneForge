/**
 * Manifest validation script.
 * Checks structural requirements beyond the official validator.
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

  // manifestVersion is stored as a number in JSON (1.1), so compare numerically.
  const mv = manifest.manifestVersion;
  if (mv !== 1.1 && mv !== "1.10" && mv !== "1.1") {
    errors.push(`Expected manifestVersion 1.10, got ${mv}`);
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

  if (errors.length > 0) {
    console.error("Manifest validation failed:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log("Manifest validation passed.");
}

main();
