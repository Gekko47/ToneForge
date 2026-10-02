/**
 * Validate the unified JSON manifest and XML fallback against the repository's
 * command contract. XML parity means equivalent user-visible command identity,
 * label, and task-pane destination. XML ShowTaskpane actions are intentionally
 * not described as executeFunction parity.
 *
 * The JSON manifest is additionally checked against Microsoft's own published
 * v1.30 schema, bundled in `@microsoft/app-manifest`. That package is a
 * dependency of `office-addin-manifest`, which is installed for `npm run
 * sideload`, so the schema is present wherever the add-in can be developed.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const defaultManifestPath = resolve(root, "manifest.json");
const defaultXmlManifestPath = resolve(root, "manifest.xml");
const commandDefinitionsPath = resolve(root, "src/commands/commandDefinitions.json");
const JSON_SCHEMA =
  "https://developer.microsoft.com/json-schemas/teams/v1.30/MicrosoftTeams.schema.json";

/**
 * Microsoft's own v1.30 JSON schema, read from the installed
 * `@microsoft/app-manifest` package.
 *
 * The `office-addin-manifest validate` CLI cannot be used for this. Before
 * validating, that CLI runs the manifest through its own generated type
 * guard, and the guard in every published build (through
 * `@microsoft/app-manifest@1.1.3-beta.2026092303.0`) declares the top-level
 * `extensions` key as an optional *object*. The published schema, the
 * package's own `TeamsManifestV1D30.d.ts` (`extensions?: ElementExtension[]`),
 * and Microsoft's v1.30 documentation all define it as an *array* with at
 * most one element. The CLI therefore rejects every spec-correct unified
 * manifest, including this one, and the failure is a crash rather than a
 * validation report. Reading the schema and validating against it directly
 * checks the same published contract without the broken intermediate step.
 */
function readPublishedSchema(errors) {
  try {
    return require("@microsoft/app-manifest/build/json-schemas/teams/v1.30/MicrosoftTeams.schema.json");
  } catch (error) {
    errors.push(`Unable to read the published v1.30 schema: ${error.message}`);
    return null;
  }
}

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

/**
 * Locate the ToneForge ribbon tab, however its opening tag is written.
 *
 * Both the parity check and the duplicate-id scan are bounded to this tab, so a
 * locator that only matches one exact spelling silently disables both: the
 * checks return nothing and the manifest passes. Attribute order and
 * whitespace are not under this repository's control once the file has been
 * through any XML formatter, so the tag is matched structurally rather than as
 * a literal — an `id` attribute is required, its position among the others is
 * not.
 *
 * Returns the bounds of the tab's contents, or `null` when there is no such
 * tab. `null` means "this manifest carries no ToneForge ribbon", which every
 * caller already treats as nothing to check.
 */
function toneForgeTabBounds(xml) {
  const open = /<OfficeTab\b[^>]*\bid="ToneForge"[^>]*>/.exec(xml);
  if (open === null) return null;
  const start = open.index;
  const end = xml.indexOf("</OfficeTab>", start);
  if (end === -1) return null;
  return { start, end };
}

function extractControls(xml, controlId) {
  const bounds = toneForgeTabBounds(xml);
  if (bounds === null) return [];
  const tab = xml.slice(bounds.start, bounds.end);
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

    /*
     * Looked up by either the command id or the JSON control's own id, because
     * the two differ wherever the control is addressable at runtime — the
     * semantic control is `ToneForgeSemanticControl` so `syncSemanticRibbon` can
     * name it. Exactly one of the two must appear, so a manifest that declares
     * both, or neither, is still an error.
     */
    const xmlControls = [
      ...extractControls(xml, definition.id),
      ...extractControls(xml, control?.id ?? definition.id),
    ].filter((xmlControl, index, all) => all.indexOf(xmlControl) === index);
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
    /*
     * ADR-0101: one add-in, one task pane.
     *
     * Only a `ShowTaskpane` action names a pane, so only a `ShowTaskpane`
     * action can be asked for a destination and a taskpane id. An
     * `ExecuteFunction` control must carry neither: naming one there is how a
     * second pane identity appeared beside the live one, because the ribbon
     * opened `ButtonId1` while the context menu opened the default `openPage`
     * pane and the host ran both.
     *
     * The rules are therefore conditional. The inverse -- that a function
     * control names no pane -- is asserted across the whole ribbon by
     * `validateSingleTaskPane`, which is where the single-pane rule belongs:
     * it covers the one control that legitimately opens the pane, which this
     * per-command loop never sees.
     */
    const opensNamedPane = actionType === "ShowTaskpane";
    if (opensNamedPane) {
      /*
       * A pane command addresses the ONE pane, and may address any PAGE of it.
       *
       * Microsoft: commands sharing a `TaskpaneId` keep "the pane container open
       * but the contents of the pane will be replaced with the corresponding
       * Action SourceLocation". So the source is how a command names the page it
       * opens, and demanding one fixed `Taskpane.Url` here would forbid the
       * documented deep link (ADR-0109). What is asserted is what actually makes
       * it the same pane -- the id -- plus the fact that the resource resolves.
       */
      const destination = sourceResId ? urls.get(sourceResId) : undefined;
      if (!destination) {
        errors.push(
          `manifest.xml is missing destination resource ${sourceResId ?? "Taskpane.Url"} for ${definition.id}`,
        );
      }
      if (taskpaneId !== "ButtonId1") {
        errors.push(`manifest.xml command ${definition.id} must use taskpane ButtonId1`);
      }
    } else {
      const functionName = /<FunctionName>([^<]+)<\/FunctionName>/.exec(xmlControl)?.[1];
      if (!functionName) {
        errors.push(`manifest.xml command ${definition.id} runs a function but names none`);
      }
    }
  }

  const registeredIds = new Set(definitions.map(({ id }) => id));
  for (const id of controls.keys()) {
    if (id.startsWith("ToneForge") && id.endsWith("Control") === false && !registeredIds.has(id)) {
      errors.push(`manifest.json contains command without a registry definition: ${id}`);
    }
  }
  /*
   * The registry holds FUNCTION commands, so a task pane command is exempt BY
   * KIND, not by name.
   *
   * Microsoft splits add-in commands in two: a *task pane command* is "code
   * provided by Office" and runs no JavaScript of ours, while a *function
   * command* runs the code `commandHandlers.ts` registers. A `openPage` action
   * is therefore the former, and it cannot appear in `commandDefinitions.json` --
   * adding it there asserts that a function exists for it, which is false, and
   * the parity loop then demands a ribbon control on the ToneForge tab that the
   * context menu control is not.
   *
   * The exemption used to be one hard-coded id, `ToneForgeTaskpane`, which is the
   * same mistake as the guard three lines up in the XML file: naming the
   * arrangement rather than the rule. A second pane command -- the semantic
   * deep link, ADR-0109 -- was rejected by the repository for using a
   * documented Office mechanism. Exempting the kind admits every task pane
   * command the host supports and still rejects an unregistered function
   * command, which is what this check is for.
   */
  for (const [id, action] of actions) {
    if (action.type === "openPage") continue;
    if (id.startsWith("ToneForge") && !registeredIds.has(id)) {
      errors.push(`manifest.json contains runtime command without a registry definition: ${id}`);
    }
  }
}

/**
 * Microsoft's cap on a manifest resource identifier.
 *
 * "A resid attribute, and the id attribute of the corresponding resource in the
 * Resources section, cannot be more than 32 characters." An over-length one is
 * not a warning the host tolerates: Word refuses the manifest, registration
 * fails, and the add-in reports "This add-in is no longer available" rather than
 * naming the manifest at all. That silence is why this is enforced here — the
 * repository's own checks all passed while sideloading was impossible.
 */
const MAX_RESOURCE_ID_LENGTH = 32;

/**
 * Reject any resource identifier in the XML manifest that exceeds the cap.
 *
 * Both sides are checked because either alone is a broken manifest: a `resid`
 * with no matching resource never resolves, and a resource nobody references is
 * dead weight the host has no way to use. Only the length is enforced, not the
 * naming convention — the limit is Microsoft's, and the convention is ours.
 */
function validateResourceIdLength(xml, errors) {
  const attributes = [
    ...xml.matchAll(/\bresid="([^"]*)"/g),
    ...xml.matchAll(/<bt:(?:Image|Url|String)\b[^>]*\bid="([^"]*)"/g),
  ];
  const reported = new Set();
  for (const attribute of attributes) {
    const id = attribute[1];
    if (id === undefined || id.length <= MAX_RESOURCE_ID_LENGTH) continue;
    // A resource used in many places is one defect, not one per usage.
    if (reported.has(id)) continue;
    reported.add(id);
    errors.push(
      `manifest.xml resource id "${id}" is ${id.length} characters; the host limit is ${MAX_RESOURCE_ID_LENGTH} and an over-length id prevents the add-in from registering`,
    );
  }
}

/**
 * Whether this manifest declares a shared runtime, which decides the pane rules.
 *
 * A long-lifetime `<Runtime>` on a `<Host>` means the task pane and the function
 * commands run in the same runtime, and such a runtime supports exactly one task
 * pane. The pane rules are therefore not a constant: a manifest with no shared
 * runtime may name a `TaskpaneId`, and one with a shared runtime may not, because
 * a named id is a second identity for the same add-in (ADR-0104).
 *
 * Read from the manifest rather than assumed from this repository, so the check
 * follows the file it is checking.
 */
function declaresSharedRuntime(surface) {
  return /<Runtime\b[^>]*\blifetime="long"/.test(surface);
}

/** The one control permitted to open the pane, and the identity it must use. */
const TASKPANE_CONTROL_ID = "ToneForgeTaskpane";
const TASKPANE_RESOURCE_ID = "Taskpane.Url";
const TASKPANE_ID = "ButtonId1";

/**
 * Reject a ribbon that declares more than one task pane (ADR-0101).
 *
 * Word keys a task pane on the `TaskpaneId` a `ShowTaskpane` action names. A
 * control that opens no pane, or one that reaches the pane by function, lands on
 * whatever identity the runtime's `openPage` action creates. Those are different
 * identities, and the host runs both: the ribbon opened `ButtonId1`, the context
 * menu opened the default, and the user got a second, blank add-in window beside
 * the working one. The live pane was correct throughout, which is what made it
 * read as a rendering fault rather than a manifest fork.
 *
 * So the shape is asserted rather than assumed, in both directions. Exactly one
 * ToneForge control may open a pane, and it must be the one named above with the
 * one id and the one destination; every other ToneForge control runs a function
 * and names neither a pane nor a source. The old check asked each *command* for a
 * `TaskpaneId`, which is why it passed on a manifest that had the defect: it
 * could not distinguish "this control opens the pane" from "this control merely
 * mentions one".
 *
 * This is the same class of defect as ADR-0082 (a host rule with no check) and
 * ADR-0080 (internal consistency mistaken for host agreement): both manifests
 * agreed, both repository checks passed, and only the host saw two panes.
 *
 * Scanned across the whole document rather than `toneForgeTabBounds`. The one
 * control that opens the pane sits on the Home tab, and the commands sit on the
 * ToneForge tab, so a scan bounded to either alone sees exactly half the ribbon:
 * bounded to the ToneForge tab it finds no pane at all, which is why this check
 * was first written there and reported zero. A rule about one pane has to read
 * the surface that panes appear on, which is the manifest.
 *
 * Comments are stripped first. This file documents its own decisions inline, and
 * a comment that names `<Control>` would otherwise be parsed as one -- a check
 * that can be fooled by prose about itself is not a check.
 */
function validateSingleTaskPane(xml, errors) {
  const surface = xml.replace(/<!--[\s\S]*?-->/g, "");
  const urls = parseXmlResources(xml, "Url");

  const controls = [...surface.matchAll(/<Control\b([^>]*)>([\s\S]*?)<\/Control>/g)]
    .map((match) => ({ id: /\bid="([^"]+)"/.exec(match[1])?.[1] ?? "", body: match[2] }))
    .filter((control) => control.id.startsWith("ToneForge"));

  const openers = controls.filter((control) =>
    /<Action\s+xsi:type="ShowTaskpane"/.test(control.body),
  );
  /*
   * More than one *opener* is fine; more than one *pane* is not.
   *
   * The context menu is a task pane command now (ADR-0107), so two controls open
   * the pane and both must name the same source. The old rule counted openers,
   * which would have failed the very change that fixed the bug \u2014 and it counted
   * for a reason worth keeping: two controls naming two *different* sources is
   * exactly the fork ADR-0101 describes. So the question is no longer "how many
   * open it" but "do they all open the same one".
   */
  if (openers.length === 0) {
    errors.push(
      `manifest.xml must declare a ToneForge control that opens the task pane; found none (ADR-0101)`,
    );
  }
  /*
   * Differing sources are ALLOWED, and are the deep-link mechanism.
   *
   * Microsoft: commands sharing a `TaskpaneId` keep "the pane container open but
   * the contents of the pane will be replaced with the corresponding Action
   * SourceLocation". So one identity with two pages is how a task pane command
   * reaches a page \u2014 it runs no JavaScript of ours, and the page it loads is the
   * only instruction it can carry (ADR-0109).
   *
   * An earlier version of this check demanded one *destination* as well as one
   * identity, which would have rejected that arrangement outright. It is the
   * third rule here that has had to be inverted, and the reason is the same each
   * time: the question is how many panes exist, and the answer is one.
   */
  const paneCommands = openers.filter((control) =>
    /<TaskpaneId>ButtonId1<\/TaskpaneId>/.test(control.body),
  );
  if (paneCommands.length !== openers.length) {
    errors.push(
      `manifest.xml has ${openers.length} pane-opening controls but ${paneCommands.length} name taskpane ${TASKPANE_ID}; every route must address ONE pane (ADR-0108)`,
    );
  }
  for (const control of controls) {
    const opensPane = /<Action\s+xsi:type="ShowTaskpane"/.test(control.body);
    const taskpaneId = /<TaskpaneId>([^<]+)<\/TaskpaneId>/.exec(control.body)?.[1];
    const sourceResId = /<SourceLocation\s+resid="([^"]+)"\s*\/>/.exec(control.body)?.[1];

    /*
     * Every pane opener's source must RESOLVE.
     *
     * This is the part of the deep-link rule that is not optional: a `resid`
     * with no matching resource never resolves, so the host opens nothing at all
     * and says nothing -- the same silent-registration failure as an over-length
     * resource id (ADR-0082). Asserting "the resource exists" is what keeps a
     * second page from becoming a second nothing.
     */
    if (opensPane) {
      const page = sourceResId === undefined ? undefined : urls.get(sourceResId);
      if (page === undefined) {
        errors.push(
          `manifest.xml control ${control.id} opens the pane at resource ${sourceResId ?? "none"}, which resolves to no page; the host opens nothing and reports nothing (ADR-0109)`,
        );
      }
    }

    if (control.id !== TASKPANE_CONTROL_ID) {
      /*
       * A pane command must name THE pane, and it must be this one.
       *
       * Microsoft documents sharing an id as the normal pattern for several
       * controls addressing one pane: "Use the same TaskpaneId for different
       * actions that share the same pane... the pane container will remain open."
       *
       * This assertion once forbade the id entirely, on a misreading of the
       * shared-runtime guidance, and that was the direct cause of two panes: two
       * ShowTaskpane actions with no id are two independent panes, confirmed in a
       * real Word. The rule is one IDENTITY \u2014 neither "no id" nor "one opener".
       */
      if (opensPane && taskpaneId !== TASKPANE_ID) {
        errors.push(
          `manifest.xml control ${control.id} opens the pane and must use taskpane ${TASKPANE_ID}, got ${taskpaneId}; a different id is a second pane (ADR-0108)`,
        );
      }
      if (!opensPane && taskpaneId) {
        errors.push(
          `manifest.xml control ${control.id} runs a function and must not declare TaskpaneId ${taskpaneId}; only a pane command names a pane (ADR-0108)`,
        );
      }
      if (!opensPane && sourceResId) {
        errors.push(
          `manifest.xml control ${control.id} runs a function and must not declare its own source; the one task pane is declared by the ShowTaskpane controls (ADR-0107)`,
        );
      }
      continue;
    }

    if (!opensPane) {
      errors.push(
        `manifest.xml task pane control ${TASKPANE_CONTROL_ID} must use ShowTaskpane (ADR-0101)`,
      );
    }
    /*
     * The shared pane identity.
     *
     * This element is what makes ONE pane. Microsoft documents it: "Use the same
     * TaskpaneId for different actions that share the same pane... the pane
     * container will remain open but the contents will be replaced." The
     * context-menu control below carries the same id, so both routes raise the
     * same container.
     *
     * This assertion once FORBADE the id, on a misreading of the shared-runtime
     * guidance, and that was the direct cause of two panes: two ShowTaskpane
     * actions with no id are two independent panes, confirmed in a real Word as
     * the context menu and the ribbon each opening their own instance. See
     * ADR-0108, which reverts ADR-0104.
     */
    if (taskpaneId !== TASKPANE_ID) {
      errors.push(
        `manifest.xml task pane ${TASKPANE_CONTROL_ID} must use taskpane ${TASKPANE_ID}, got ${taskpaneId}`,
      );
    }
    if (sourceResId !== TASKPANE_RESOURCE_ID) {
      errors.push(
        `manifest.xml destination mismatch for ${TASKPANE_CONTROL_ID}: expected ${TASKPANE_RESOURCE_ID}, got ${sourceResId}`,
      );
    }
    const destination = sourceResId ? urls.get(sourceResId) : undefined;
    if (!destination) {
      errors.push(
        `manifest.xml is missing destination resource ${TASKPANE_RESOURCE_ID} for ${TASKPANE_CONTROL_ID}`,
      );
    } else if (!destination.endsWith("/taskpane.html")) {
      errors.push(
        `manifest.xml task pane ${TASKPANE_CONTROL_ID} must open taskpane.html, got ${destination}`,
      );
    }
  }
}

/**
 * Reject a UI element id used twice on the same ribbon surface.
 *
 * Word requires every UI element id — tab, group, and control alike — to be
 * unique across a ribbon surface, and a repeat makes it reject the *entire*
 * manifest. The log line is specific ("Duplicate UI element id specified ... id:
 * ToneForgeProfile") while the user sees only "This add-in is no longer
 * available", so the symptom reads as a broken sideload procedure when it is a
 * manifest defect.
 *
 * The cause here was a group and a control inside it sharing a name, introduced
 * by renaming the group to match its label. Every other group in the manifest
 * ends in `Group`; that one did not, and nothing in this repository noticed,
 * because the parity check compares the two manifests against each other and
 * both were edited together. That is the same class of defect as ADR-0080's:
 * a host rule the repository has no check for.
 *
 * Ribbon ids only. Resource ids (`Icon.32x32`, `Taskpane.Url`) are a separate
 * namespace with their own rule — the 32-character cap, enforced by
 * `validateResourceIdLength` — and reusing a name across the two is legal.
 */
function validateUniqueUiElementIds(xml, errors) {
  // Ribbon ids only, so the scan is bounded to the tab that carries the ribbon.
  // Located structurally, not as a literal: see `toneForgeTabBounds`.
  const bounds = toneForgeTabBounds(xml);
  if (bounds === null) return;
  const tab = xml.slice(bounds.start, bounds.end);

  const seen = new Map();
  const reported = new Set();
  /*
   * `OfficeTab` is captured alongside `Tab`, `Group` and `Control` because it
   * carries an id in the same namespace and the host holds it to the same rule.
   * The enclosing tab is inside the slice this function scans, so leaving it out
   * meant a group or control that reused the tab's own id was reported as
   * unique — the same defect as a group colliding with a control, one level up.
   */
  const elements = /<(OfficeTab|Tab|Group|Control)\b[^>]*\bid="([^"]*)"/g;
  for (const match of tab.matchAll(elements)) {
    const kind = match[1];
    const id = match[2];
    if (kind === undefined || id === undefined) continue;
    const previous = seen.get(id);
    if (previous === undefined) {
      seen.set(id, kind);
      continue;
    }
    // A pair is one defect however many times it recurs.
    if (reported.has(id)) continue;
    reported.add(id);
    errors.push(
      `manifest.xml UI element id "${id}" is used by both a <${previous}> and a <${kind}> on the ToneForge ribbon; Word requires these ids to be unique and rejects the entire manifest, which presents as "This add-in is no longer available"`,
    );
  }
}

/**
 * Reject a `Control` that omits its required `xsi:type`.
 *
 * Microsoft documents `xsi:type` as required on `Control` — Button, Menu, or
 * MobileButton. Word does not treat a missing one as a problem with that single
 * control: it fails to parse the manifest and rejects the whole add-in, so
 * every ribbon entry disappears at once. The context-menu `Control` added in
 * commit 8a4878f shipped without it, and the symptom reported to the user was
 * "This add-in is no longer available" — which names a manifest at no point.
 */
function validateControlType(xml, errors) {
  const controls = /<Control\b[^>]*>/g;
  for (const match of xml.matchAll(controls)) {
    const tag = match[0];
    if (/\bxsi:type="/.test(tag)) continue;
    const id = /\bid="([^"]*)"/.exec(tag)?.[1] ?? "(no id)";
    errors.push(
      `manifest.xml Control ${id} is missing the required xsi:type attribute (Button, Menu, or MobileButton); Word rejects the entire manifest without it, not just this control`,
    );
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

/**
 * Validate the manifest against Microsoft's published v1.30 JSON schema.
 *
 * Uses the same `AppManifestUtils.validateAgainstSchema` the official CLI uses
 * once it has converted the manifest, so the contract checked here is the one
 * Microsoft publishes rather than a local re-implementation of it.
 */
async function validatePublishedSchema(manifest, schema, errors) {
  let failures;
  try {
    const { AppManifestUtils } = require("@microsoft/app-manifest");
    failures = await AppManifestUtils.validateAgainstSchema(manifest, schema);
  } catch (error) {
    errors.push(`manifest.json could not be validated against the v1.30 schema: ${error.message}`);
    return;
  }
  for (const failure of failures ?? []) {
    errors.push(`manifest.json violates the v1.30 schema: ${failure}`);
  }
}

export async function validateManifests({
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
  if (xml) {
    // Here, not inside validateXmlFallback: a caller supplying the XML directly
    // bypasses that function entirely, and a check that only runs on one of the
    // two paths is a check the test suite cannot exercise.
    validateResourceIdLength(xml, errors);
    validateControlType(xml, errors);
    validateUniqueUiElementIds(xml, errors);
    validateSingleTaskPane(xml, errors);
    validateCommandParity(manifest, xml, definitions, errors);
  }

  if (runOfficialValidator) {
    const schema = readPublishedSchema(errors);
    if (schema !== null) {
      await validatePublishedSchema(manifest, schema, errors);
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
  const errors = await validateManifests(parseArguments());
  if (errors.length > 0) {
    console.error("Manifest validation failed:");
    errors.forEach((error) => console.error(`  - ${error}`));
    process.exit(1);
  }
  console.log(
    "Manifest validation passed: JSON/XML command identity, labels, and destinations match.",
  );
}
