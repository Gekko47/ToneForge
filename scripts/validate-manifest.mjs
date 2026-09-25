/**
 * Validate the unified JSON manifest and XML fallback against the repository's
 * command contract. XML parity means equivalent user-visible command identity,
 * label, and task-pane destination. XML ShowTaskpane actions are intentionally
 * not described as executeFunction parity.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const defaultManifestPath = resolve(root, "manifest.json");
const defaultXmlManifestPath = resolve(root, "manifest.xml");
const commandDefinitionsPath = resolve(root, "src/commands/commandDefinitions.json");
const JSON_SCHEMA =
  "https://developer.microsoft.com/json-schemas/teams/v1.30/MicrosoftTeams.schema.json";

function readJson(path, label, errors) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function flattenJsonControls(manifest) {
  const controls = new Map();
  for (const extension of manifest?.extensions ?? []) {
    for (const ribbon of extension?.ribbons ?? []) {
      for (const tab of ribbon?.tabs ?? []) {
        for (const group of tab?.groups ?? []) {
          for (const control of group?.controls ?? []) {
            if (control?.id) controls.set(control.id, control);
          }
        }
      }
    }
  }
  return controls;
}

function flattenJsonActions(manifest) {
  const actions = new Map();
  for (const extension of manifest?.extensions ?? []) {
    for (const runtime of extension?.runtimes ?? []) {
      for (const action of runtime?.actions ?? []) {
        if (action?.id) actions.set(action.id, { ...action, runtimeId: runtime.id });
      }
    }
  }
  return actions;
}

function validateUnifiedStructure(manifest, errors) {
  if (manifest.manifestVersion !== "1.30") {
    errors.push(`Expected manifestVersion "1.30", got ${manifest.manifestVersion}`);
  }
  if (manifest.$schema !== JSON_SCHEMA) {
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
  if (!manifest.id || typeof manifest.id !== "string")
    errors.push("Missing or invalid manifest.id");
  if (!manifest.name?.short) errors.push("Missing manifest.name.short");
  if (!manifest.description?.short || !manifest.description?.full) {
    errors.push("manifest.description.short and manifest.description.full are required");
  }
  if (manifest.icons?.outline === undefined || manifest.icons?.color === undefined) {
    errors.push("manifest.icons must include outline and color (and optionally color32x32)");
  }
  if (!Array.isArray(manifest.validDomains) || manifest.validDomains.length === 0) {
    errors.push("manifest.validDomains must be a non-empty array");
  }

  const developer = manifest.developer ?? {};
  for (const field of ["contactUrl", "supportUrl"]) {
    if (developer[field] !== undefined) {
      errors.push(`developer.${field} is an XML-manifest-only field and is not valid in v1.30`);
    }
  }
  for (const field of ["websiteUrl", "privacyUrl", "termsOfUseUrl"]) {
    if (developer[field] !== undefined && typeof developer[field] !== "string") {
      errors.push(`developer.${field} must be a string, got ${typeof developer[field]}`);
    }
  }
  if (manifest.publisher !== undefined) {
    errors.push("manifest.publisher is an XML-manifest-only concept; use manifest.developer");
  }

  const extensions = manifest.extensions ?? [];
  if (!Array.isArray(extensions) || extensions.length === 0) {
    errors.push("manifest.extensions must contain at least one extension");
  }
  for (const extension of extensions) {
    for (const forbidden of ["host", "version", "entryPoints", "actions"]) {
      if (extension?.[forbidden] !== undefined) {
        errors.push(`manifest.extensions[].${forbidden} is invalid for unified manifest v1.30`);
      }
    }
    const requirements = extension?.requirements ?? {};
    if (!Array.isArray(requirements.scopes) || requirements.scopes.length === 0) {
      errors.push("manifest.extensions[].requirements.scopes must be a non-empty array");
    }
    if (!Array.isArray(requirements.capabilities) || requirements.capabilities.length === 0) {
      errors.push("manifest.extensions[].requirements.capabilities must be a non-empty array");
    }
    if (!Array.isArray(extension?.ribbons) || extension.ribbons.length === 0) {
      errors.push("manifest.extensions[].ribbons must be a non-empty array for Word ribbon UI");
    }
    if (!Array.isArray(extension?.runtimes) || extension.runtimes.length === 0) {
      errors.push("manifest.extensions[].runtimes must be a non-empty array");
    }
    for (const runtime of extension?.runtimes ?? []) {
      if (runtime?.type !== "general") {
        errors.push('manifest.extensions[].runtimes[].type must be "general"');
      }
      if (!runtime?.code?.page) {
        errors.push("manifest.extensions[].runtimes[].code.page is required");
      }
      if (!Array.isArray(runtime?.actions) || runtime.actions.length === 0) {
        errors.push("manifest.extensions[].runtimes[].actions must be a non-empty array");
      }
    }
  }
}

function parseXmlResources(xml, tag) {
  const resources = new Map();
  const expression = new RegExp(`<bt:${tag}\\b([^>]*)\\/?>`, "g");
  let match;
  while ((match = expression.exec(xml)) !== null) {
    const id = /\bid="([^"]+)"/.exec(match[1])?.[1];
    const value = /\bDefaultValue="([^"]+)"/.exec(match[1])?.[1];
    if (id) resources.set(id, value);
  }
  return resources;
}

function extractControls(xml, controlId) {
  const tabStart = xml.indexOf('<OfficeTab id="ToneForge">');
  if (tabStart === -1) return [];
  const tabEnd = xml.indexOf("</OfficeTab>", tabStart);
  const tab = xml.slice(tabStart, tabEnd === -1 ? undefined : tabEnd);
  const controls = [];
  const expression = /<Control\b([^>]*)>([\s\S]*?)<\/Control>/g;
  let match;
  while ((match = expression.exec(tab)) !== null) {
    const id = /\bid="([^"]+)"/.exec(match[1])?.[1];
    if (id === controlId) controls.push(match[2]);
  }
  return controls;
}

function validateCommandParity(manifest, xml, definitions, errors) {
  const controls = flattenJsonControls(manifest);
  const actions = flattenJsonActions(manifest);

  for (const definition of definitions) {
    const control = [...controls.values()].find(
      (candidate) => candidate.actionId === definition.id,
    );
    if (!control) {
      errors.push(`manifest.json is missing ribbon control for command: ${definition.id}`);
    } else {
      if (control.label !== definition.label) {
        errors.push(
          `manifest.json label mismatch for ${definition.id}: expected "${definition.label}", got "${control.label}"`,
        );
      }
    }

    const action = actions.get(definition.id);
    if (!action) {
      errors.push(`manifest.json is missing runtime action for command: ${definition.id}`);
    } else {
      if (action.type !== definition.jsonAction) {
        errors.push(
          `manifest.json action type mismatch for ${definition.id}: expected ${definition.jsonAction}, got ${action.type}`,
        );
      }
      if (action.runtimeId !== "CommandsRuntime") {
        errors.push(`${definition.id} must belong to CommandsRuntime, got ${action.runtimeId}`);
      }
    }

    const xmlControls = extractControls(xml, definition.id);
    if (xmlControls.length !== 1) {
      errors.push(
        `manifest.xml must contain exactly one ToneForge ribbon control for ${definition.id}; found ${xmlControls.length}`,
      );
      continue;
    }
    const xmlControl = xmlControls[0] ?? "";
    const labelResId = /<Label\s+resid="([^"]+)"\s*\/>/.exec(xmlControl)?.[1];
    const actionType = /<Action\s+xsi:type="([^"]+)"/.exec(xmlControl)?.[1];
    const sourceResId = /<SourceLocation\s+resid="([^"]+)"\s*\/>/.exec(xmlControl)?.[1];
    const taskpaneId = /<TaskpaneId>([^<]+)<\/TaskpaneId>/.exec(xmlControl)?.[1];
    const shortStrings = parseXmlResources(xml, "String");
    const urls = parseXmlResources(xml, "Url");

    if (!labelResId || shortStrings.get(labelResId) !== definition.label) {
      errors.push(
        `manifest.xml label mismatch for ${definition.id}: expected "${definition.label}"`,
      );
    }
    if (actionType !== definition.xmlAction) {
      errors.push(
        `manifest.xml action mismatch for ${definition.id}: expected ${definition.xmlAction}, got ${actionType}`,
      );
    }
    if (sourceResId !== "Taskpane.Url") {
      errors.push(
        `manifest.xml destination mismatch for ${definition.id}: expected Taskpane.Url, got ${sourceResId}`,
      );
    }
    const destination = sourceResId ? urls.get(sourceResId) : undefined;
    if (!destination) {
      errors.push(
        `manifest.xml is missing destination resource ${sourceResId ?? "Taskpane.Url"} for ${definition.id}`,
      );
    } else if (!destination.endsWith("/taskpane.html")) {
      errors.push(
        `manifest.xml command ${definition.id} must open taskpane.html, got ${destination}`,
      );
    }
    if (taskpaneId !== "ButtonId1") {
      errors.push(`manifest.xml command ${definition.id} must use taskpane ButtonId1`);
    }
  }

  const registeredIds = new Set(definitions.map(({ id }) => id));
  for (const id of controls.keys()) {
    if (id.startsWith("ToneForge") && id.endsWith("Control") === false && !registeredIds.has(id)) {
      errors.push(`manifest.json contains command without a registry definition: ${id}`);
    }
  }
  for (const id of actions.keys()) {
    if (id.startsWith("ToneForge") && id !== "ToneForgeTaskpane" && !registeredIds.has(id)) {
      errors.push(`manifest.json contains runtime command without a registry definition: ${id}`);
    }
  }
}

function validateXmlFallback(xmlPath, jsonId, errors) {
  if (!existsSync(xmlPath)) {
    errors.push("manifest.xml (XML fallback) is missing");
    return null;
  }
  let xml;
  try {
    xml = readFileSync(xmlPath, "utf8");
  } catch (error) {
    errors.push(`Unable to read manifest.xml: ${error.message}`);
    return null;
  }
  if (!/^\s*<\?xml[^>]*\?>/.test(xml))
    errors.push("manifest.xml must begin with an XML declaration");
  if (!/<OfficeApp[\s>]/.test(xml)) errors.push("manifest.xml root element must be <OfficeApp>");
  if (!/xmlns:bt="[^"]+"/.test(xml)) errors.push("manifest.xml must declare xmlns:bt");
  if (/<Host Name="Word"\s*\/>/.test(xml))
    errors.push('manifest.xml base Host must use Name="Document"');
  if (!/<Host xsi:type="Document">/.test(xml)) {
    errors.push('manifest.xml VersionOverrides Host must use xsi:type="Document"');
  }
  if (!/<Permissions>/.test(xml)) errors.push("manifest.xml must declare <Permissions>");
  for (const forbidden of ["ResFile", "ResStringPack", "Path"]) {
    if (new RegExp(`<bt:${forbidden}\\b`).test(xml)) {
      errors.push(`manifest.xml must not use <bt:${forbidden}>`);
    }
  }
  const xmlId = /<Id>([0-9a-fA-F-]{36})<\/Id>/.exec(xml)?.[1];
  if (xmlId && jsonId && xmlId.toLowerCase() !== jsonId.toLowerCase()) {
    errors.push(`manifest.xml Id (${xmlId}) does not match manifest.json id (${jsonId})`);
  }
  return xml;
}

export function validateManifests({
  manifestPath = defaultManifestPath,
  xmlManifestPath = defaultXmlManifestPath,
  commandDefinitionsPath: definitionsPath = commandDefinitionsPath,
  manifest: suppliedManifest,
  xml: suppliedXml,
  runOfficialValidator = process.platform !== "win32",
} = {}) {
  const errors = [];
  const manifest = suppliedManifest ?? readJson(manifestPath, "manifest.json", errors);
  const definitions = readJson(definitionsPath, "command definitions", errors);
  if (!manifest || !definitions) return errors;

  validateUnifiedStructure(manifest, errors);
  const xml = suppliedXml ?? validateXmlFallback(xmlManifestPath, manifest.id, errors);
  if (xml) validateCommandParity(manifest, xml, definitions, errors);

  if (
    runOfficialValidator &&
    existsSync(resolve(root, "node_modules/.bin/office-addin-manifest"))
  ) {
    try {
      execFileSync("node_modules/.bin/office-addin-manifest", ["validate", manifestPath], {
        cwd: root,
        stdio: "pipe",
      });
    } catch {
      errors.push("office-addin-manifest validation failed for manifest.json");
    }
  }
  return errors;
}

function parseArguments() {
  const args = process.argv.slice(2);
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") values.set("manifestPath", resolve(args[++index] ?? ""));
    if (argument === "--xml") values.set("xmlManifestPath", resolve(args[++index] ?? ""));
  }
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validateManifests(parseArguments());
  if (errors.length > 0) {
    console.error("Manifest validation failed:");
    errors.forEach((error) => console.error(`  - ${error}`));
    process.exit(1);
  }
  console.log(
    "Manifest validation passed: JSON/XML command identity, labels, and destinations match.",
  );
}
