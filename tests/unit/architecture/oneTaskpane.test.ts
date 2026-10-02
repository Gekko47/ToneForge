/**
 * One add-in, one task pane.
 *
 * The XML manifest gave eight ribbon controls a `ShowTaskpane` action against
 * `TaskpaneId` `ButtonId1`, while the context menu ran an `ExecuteFunction`,
 * which reaches the **default** pane. That is two task pane identities for one
 * add-in, and Word resolved it by opening a second blank pane beside the live
 * one — the live pane still received the selection over the `storage` event
 * (ADR-0079), so the duplication looked like a harmless extra window and the
 * original pane behaved correctly throughout. (ADR-0101.)
 *
 * These are assertions over the manifests rather than over a component, because
 * the defect *is* in the manifests: nothing in TypeScript can observe how many
 * panes Word believes the add-in has.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const xml = readFileSync("manifest.xml", "utf8");
const json = JSON.parse(readFileSync("manifest.json", "utf8")) as {
  extensions: Array<{
    ribbons: Array<{ tabs: Array<{ groups: Array<{ controls: Array<{ id: string }> }> }> }>;
    runtimes: Array<{ id: string; actions: Array<{ id: string; type: string }> }>;
  }>;
};

/** Every `<Control ...>...</Control>` block, with its id. */
function xmlControls(): Array<{ id: string; body: string }> {
  const pattern = /<Control xsi:type="Button" id="([^"]+)">([\s\S]*?)<\/Control>/g;
  return [...xml.matchAll(pattern)].map((match) => ({
    id: match[1] as string,
    body: match[2] as string,
  }));
}

describe("one task pane for the whole add-in", () => {
  it("declares exactly one ShowTaskpane action in the XML manifest", () => {
    const showTaskpane = xmlControls().filter((control) =>
      control.body.includes('xsi:type="ShowTaskpane"'),
    );

    // More than one identity means Word can open a second pane. The one that
    // survives is the entry point, which *is* the pane and should open it.
    expect(showTaskpane.map((control) => control.id)).toEqual(["ToneForgeTaskpane"]);
  });

  it("routes every other XML control through a function, so none names a pane", () => {
    const actionControls = xmlControls().filter((control) => control.id !== "ToneForgeTaskpane");

    expect(actionControls.length).toBeGreaterThan(0);
    actionControls.forEach((control) => {
      expect(control.body, `${control.id} must run a function`).toContain(
        'xsi:type="ExecuteFunction"',
      );
      expect(control.body, `${control.id} must not name a taskpane`).not.toContain("TaskpaneId");
    });
  });

  it("keeps the pane identity itself, so a function has somewhere to go", () => {
    // The inverse failure: converting every control and removing the pane entry
    // point would leave every command opening nothing.
    expect(xml).toContain("<TaskpaneId>ButtonId1</TaskpaneId>");
    expect(xml).toContain('<SourceLocation resid="Taskpane.Url" />');
  });

  it("names a global function that exists, for every XML ExecuteFunction", () => {
    const handlers = readFileSync("src/commands/commandHandlers.ts", "utf8");
    const declared = new Set(
      [...handlers.matchAll(/export async function (\w+)\(/g)].map((match) => match[1] as string),
    );

    const called = new Set(
      [...xml.matchAll(/<FunctionName>(\w+)<\/FunctionName>/g)].map((match) => match[1] as string),
    );

    expect(called.size).toBeGreaterThan(0);
    // The XML manifest resolves `onAction` against a global, so a name with no
    // export is a button that silently does nothing — the failure ADR-0079
    // records for the other direction.
    [...called].forEach((name) => {
      expect(declared.has(name), `XML calls ${name}, which is not exported`).toBe(true);
    });
  });

  it("agrees with the JSON manifest about which functions exist", () => {
    const extension = json.extensions[0];
    expect(extension).toBeDefined();
    if (extension === undefined) return;

    const jsonExecuteFunctions = extension.runtimes
      .flatMap((runtime) => runtime.actions)
      .filter((action) => action.type === "executeFunction")
      .map((action) => action.id);
    const xmlFunctions = new Set(
      [...xml.matchAll(/<FunctionName>(\w+)<\/FunctionName>/g)].map((match) => match[1] as string),
    );

    // ADR-0070: the two manifests are separate files that a user can sideload
    // either of, and a control present in one and not the other passes every
    // check here and produces a Word that has never heard of it.
    expect([...jsonExecuteFunctions].sort()).toEqual([...xmlFunctions].sort());
  });
});
