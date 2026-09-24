/**
 * Manifest validation script.
 * Checks structural requirements beyond the official validator.
 *
 * This script validates the unified manifest v1.30 structure used by
 * ToneForge. It enforces that the manifest does not mix unified manifest
 * features with XML-manifest-only features, and that all required fields are
 * present and correctly typed.
 *
 * XML fallback: manifest.xml is provided alongside manifest.json for
 * platforms that do not yet support the unified manifest. The two must
 * stay in sync; see README.md for the conversion procedure.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, "../manifest.json");
const xmlManifestPath = resolve(__dirname, "../manifest.xml");

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

  // manifestVersion is stored as a string in unified manifest (e.g. "1.30").
  const mv = manifest.manifestVersion;
  if (mv !== "1.30") {
    errors.push(`Expected manifestVersion "1.30", got ${mv}`);
  }
  if (
    manifest.$schema !==
    "https://developer.microsoft.com/json-schemas/teams/v1.30/MicrosoftTeams.schema.json"
  ) {
    errors.push("Expected $schema to point to the v1.30 unified manifest schema");
  }
  if (manifest.host !== undefined) {
    errors.push(
      "manifest.host is an XML-manifest-only feature; use extensions[].requirements for unified manifest v1.30",
    );
  }
  if (manifest.permissions !== undefined) {
    errors.push(
      "manifest.permissions is a Teams-only field; use extensions[].requirements.scopes for Office Add-in access",
    );
  }
  if (!manifest.id || typeof manifest.id !== "string") {
    errors.push("Missing or invalid manifest.id");
  }
  if (!manifest.name?.short) {
    errors.push("Missing manifest.name.short");
  }
  if (!manifest.description?.short || !manifest.description?.full) {
    errors.push("manifest.description.short and manifest.description.full are required");
  }
  if (manifest.icons?.outline === undefined || manifest.icons?.color === undefined) {
    errors.push("manifest.icons must include outline and color (and optionally color32x32)");
  }
  if (!Array.isArray(manifest.validDomains) || manifest.validDomains.length === 0) {
    errors.push("manifest.validDomains must be a non-empty array");
  }

  // Unified manifest v1.30 developer object uses websiteUrl, privacyUrl,
  // termsOfUseUrl. It does NOT have contactUrl/supportUrl — those are
  // XML-manifest-only fields. Reject them if present to catch drift.
  const dev = manifest.developer ?? {};
  if (dev.contactUrl !== undefined) {
    errors.push(
      "developer.contactUrl is not part of unified manifest v1.30; use developer.websiteUrl instead",
    );
  }
  if (dev.supportUrl !== undefined) {
    errors.push(
      "developer.supportUrl is not part of unified manifest v1.30; add a support URL to developer.websiteUrl or a dedicated page",
    );
  }
  if (dev.websiteUrl !== undefined && typeof dev.websiteUrl !== "string") {
    errors.push(`developer.websiteUrl must be a string, got ${typeof dev.websiteUrl}`);
  }
  if (dev.privacyUrl !== undefined && typeof dev.privacyUrl !== "string") {
    errors.push(`developer.privacyUrl must be a string, got ${typeof dev.privacyUrl}`);
  }
  if (dev.termsOfUseUrl !== undefined && typeof dev.termsOfUseUrl !== "string") {
    errors.push(`developer.termsOfUseUrl must be a string, got ${typeof dev.termsOfUseUrl}`);
  }

  // The `publisher` object is an XML-manifest-only concept. In the unified
  // manifest, publisher information lives on `developer`. Reject `publisher`
  // to catch schema-model mixing.
  if (manifest.publisher !== undefined) {
    errors.push(
      "manifest.publisher is an XML-manifest-only feature; use manifest.developer for unified manifest v1.30",
    );
  }

  // Unified manifest v1.30 uses `extensions` with `requirements`, optional
  // `ribbons`, and nested `runtimes`. The taskpane and function-command
  // runtimes are both required for the Phase C ribbon navigation seam.
  const extensions = manifest.extensions ?? [];
  const commandActionIds = new Set();
  if (extensions.length === 0) {
    errors.push("manifest.extensions must contain at least one extension");
  }
  for (const ext of extensions) {
    if (!Array.isArray(ext.ribbons) || ext.ribbons.length === 0) {
      errors.push("manifest.extensions[].ribbons must be a non-empty array for Word ribbon UI");
    }
    for (const ribbon of ext.ribbons ?? []) {
      for (const tab of ribbon.tabs ?? []) {
        for (const group of tab.groups ?? []) {
          for (const control of group.controls ?? []) {
            if (control.actionId) commandActionIds.add(control.actionId);
          }
        }
      }
    }
    const runtimeActionIds = new Set();
    for (const runtime of ext.runtimes ?? []) {
      for (const action of runtime.actions ?? []) {
        if (action.type === "executeFunction") runtimeActionIds.add(action.id);
      }
    }
    for (const actionId of commandActionIds) {
      if (!runtimeActionIds.has(actionId)) {
        errors.push(`Ribbon actionId lacks an executeFunction action: ${actionId}`);
      }
    }
    for (const actionId of runtimeActionIds) {
      if (!commandActionIds.has(actionId)) {
        errors.push(`executeFunction action lacks a ribbon control: ${actionId}`);
      }
    }
    if (ext.host !== undefined) {
      errors.push(
        "manifest.extensions[].host is an XML-manifest-only feature; use requirements.scopes for unified manifest v1.30",
      );
    }
    if (ext.version !== undefined) {
      errors.push(
        "manifest.extensions[].version is an XML-manifest-only feature; use requirements.capabilities for unified manifest v1.30",
      );
    }
    if (ext.entryPoints !== undefined) {
      errors.push(
        "manifest.extensions[].entryPoints is an XML-manifest-only feature; use runtimes[].code for unified manifest v1.30",
      );
    }
    if (ext.actions !== undefined) {
      errors.push(
        "manifest.extensions[].actions must be nested inside extensions[].runtimes[].actions for unified manifest v1.30",
      );
    }
    const req = ext.requirements ?? {};
    if (!Array.isArray(req.scopes) || req.scopes.length === 0) {
      errors.push("manifest.extensions[].requirements.scopes must be a non-empty array");
    }
    if (!Array.isArray(req.capabilities) || req.capabilities.length === 0) {
      errors.push("manifest.extensions[].requirements.capabilities must be a non-empty array");
    }
    if (!Array.isArray(ext.runtimes) || ext.runtimes.length === 0) {
      errors.push("manifest.extensions[].runtimes must be a non-empty array");
    }
    for (const runtime of ext.runtimes ?? []) {
      if (runtime.type !== "general") {
        errors.push(
          'manifest.extensions[].runtimes[].type must be "general" for unified manifest v1.30',
        );
      }
      // Unified manifest v1.30 requires only `page` for an openPage runtime;
      // `script` is optional and is omitted by ToneForge because the build
      // emits content-hashed bundles, not a stable taskpane.js file.
      if (!runtime.code?.page) {
        errors.push("manifest.extensions[].runtimes[].code.page is required");
      }
      if (runtime.code?.script !== undefined && typeof runtime.code.script !== "string") {
        errors.push("manifest.extensions[].runtimes[].code.script must be a string when present");
      }
      if (!Array.isArray(runtime.actions) || runtime.actions.length === 0) {
        errors.push("manifest.extensions[].runtimes[].actions must be a non-empty array");
      }
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

  // XML fallback must exist alongside the unified manifest so platforms
  // that do not yet support the unified manifest can still load the add-in.
  if (!existsSync(xmlManifestPath)) {
    errors.push(
      "manifest.xml (XML fallback) is missing; create it for platforms that do not support unified manifest v1.30",
    );
  } else {
    const xmlErrors = validateXmlFallback(xmlManifestPath, manifest.id);
    for (const e of xmlErrors) errors.push(e);
  }

  const commandsSource = readFileSync(
    new URL("../src/commands/commands.ts", import.meta.url),
    "utf8",
  );
  for (const actionId of commandActionIds) {
    if (!new RegExp(`\\b${actionId}\\b`).test(commandsSource)) {
      errors.push(`Manifest action is not associated in src/commands/commands.ts: ${actionId}`);
    }
  }

  // The npm validator currently rejects the documented v1.30 array shape at
  // `extensions` even though Microsoft's schema and samples require an array.
  // Keep the structural checks above authoritative until that upstream defect
  // is corrected; changing the manifest to an object would ship an invalid file.
  if (process.platform !== "win32" && existsSync("node_modules/.bin/office-addin-manifest")) {
    try {
      execFileSync("node_modules/.bin/office-addin-manifest", ["validate", "manifest.json"], {
        stdio: "pipe",
      });
    } catch {
      errors.push("office-addin-manifest validation failed for manifest.json");
    }
  }

  if (errors.length > 0) {
    console.error("Manifest validation failed:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log("Manifest validation passed.");
}

function validateXmlFallback(xmlPath, jsonId) {
  const errors = [];
  let xml;
  try {
    xml = readFileSync(xmlPath, "utf-8");
  } catch (err) {
    errors.push(`Unable to read manifest.xml: ${err.message}`);
    return errors;
  }
  if (!/^\s*<\?xml[^>]*\?>/.test(xml)) {
    errors.push("manifest.xml must begin with an XML declaration");
  }
  if (!/<OfficeApp[\s>]/.test(xml)) {
    errors.push("manifest.xml root element must be <OfficeApp>");
  }
  if (!/xmlns:bt="[^"]+"/.test(xml)) {
    errors.push("manifest.xml must declare xmlns:bt for bt:* resources");
  }
  if (/<Host Name="Word"\s*\/>/.test(xml)) {
    errors.push('manifest.xml base <Host> must use Name="Document" for Word, not "Word"');
  }
  if (/<Host Name="Word">/.test(xml)) {
    errors.push(
      'manifest.xml VersionOverrides <Host> must use xsi:type="Document" for Word, not Name="Word"',
    );
  }
  if (!/<Host xsi:type="Document">/.test(xml)) {
    errors.push('manifest.xml VersionOverrides <Host> must use xsi:type="Document" for Word');
  }
  if (!/<Permissions>/.test(xml)) {
    errors.push("manifest.xml must declare <Permissions> for task-pane add-ins");
  }
  if (/<bt:ResFile\b/.test(xml)) {
    errors.push("manifest.xml must not use <bt:ResFile>; use <bt:Urls>/<bt:Url> instead");
  }
  if (/<bt:ResStringPack\b/.test(xml)) {
    errors.push(
      "manifest.xml must not use <bt:ResStringPack>; use <bt:ShortStrings>/<bt:LongStrings> instead",
    );
  }
  if (/<bt:Path\b/.test(xml)) {
    errors.push("manifest.xml must not use <bt:Path>; use <bt:String> instead");
  }
  if (/<bt:Url id="Taskpane.Url"/.test(xml) === false) {
    errors.push("manifest.xml must declare a Taskpane.Url resource");
  }
  const xmlIdMatch = xml.match(
    /<Id>([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})<\/Id>/,
  );
  if (xmlIdMatch && jsonId && xmlIdMatch[1].toLowerCase() !== jsonId.toLowerCase()) {
    errors.push(`manifest.xml Id (${xmlIdMatch[1]}) does not match manifest.json id (${jsonId})`);
  }
  return errors;
}

main();
