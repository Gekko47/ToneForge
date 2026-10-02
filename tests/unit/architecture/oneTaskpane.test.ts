/**
 * One add-in, one task pane.
 *
 * **The pane identity was the defect, and the first check demanded it.** A
 * `TaskpaneId` names a separate task pane; this manifest also declares a
 * long-lifetime shared runtime, which supports exactly one. The id therefore
 * created a second identity, and `Office.addin.showAsTaskpane()` \u2014 which every
 * command calls \u2014 opened the shared runtime's function file as a blank add-in
 * pane beside the live one. (ADR-0104, amending ADR-0101.)
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

/**
 * The manifest with its comments removed.
 *
 * The manifest documents this file's own decisions inline, and a comment that
 * names an element would otherwise be read as one. The first version of the
 * check below was satisfied by prose: it asserted the manifest contained no
 * `<TaskpaneId>`, and the comment explaining *why* it must not \u2014 added in the
 * same change \u2014 contained the string. `validateSingleTaskPane` strips comments
 * for the same reason, and the two now agree.
 */
const xml = readFileSync("manifest.xml", "utf8");
const xmlWithoutComments = xml.replace(/<!--[\s\S]*?-->/g, "");

/** Every `<Control ...>...</Control>` block, with its id, comments already gone. */
function liveControls(): Array<{ id: string; body: string }> {
  return [...xmlWithoutComments.matchAll(/<Control\b([^>]*)>([\s\S]*?)<\/Control>/g)].map(
    (match) => ({ id: /\bid="([^"]+)"/.exec(match[1] ?? "")?.[1] ?? "", body: match[2] ?? "" }),
  );
}
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

/** Every `<bt:Url id="..." DefaultValue="..."/>`, by id. */
function xmlUrls(): Map<string, string> {
  const urls = new Map<string, string>();
  for (const match of xml.matchAll(/<bt:Url\b([^>]*)\/?>/g)) {
    const id = /\bid="([^"]+)"/.exec(match[1] ?? "")?.[1];
    const value = /\bDefaultValue="([^"]+)"/.exec(match[1] ?? "")?.[1];
    if (id !== undefined && value !== undefined) urls.set(id, value);
  }
  return urls;
}

/** The page each pane-opening control names, as the host would resolve it. */
function panePages(): Map<string, string> {
  const urls = xmlUrls();
  const pages = new Map<string, string>();
  for (const control of liveControls()) {
    if (!control.body.includes('xsi:type="ShowTaskpane"')) continue;
    const resid = /<SourceLocation\s+resid="([^"]+)"\s*\/>/.exec(control.body)?.[1];
    const page = resid === undefined ? undefined : urls.get(resid);
    if (page !== undefined) pages.set(control.id, page);
  }
  return pages;
}

describe("one task pane for the whole add-in", () => {
  /*
   * TWO controls open the pane, and both name the SAME one.
   *
   * This assertion used to say exactly one ShowTaskpane control may exist, and it
   * would have rejected the change that fixed the blank-window bug. The context
   * menu is a task pane command now, because Microsoft documents that a task pane
   * command's code is "provided by Office" \u2014 the host resolves the pane itself \u2014
   * and no runtime sits in the path able to fall back to the shared runtime's
   * function file, which is what the blank window was (ADR-0107).
   *
   * So the question is no longer "how many open it" but "do they all open the
   * same one", and the destination is asserted separately below.
   */
  it("opens one and the same pane from every control that opens one", () => {
    const showTaskpane = xmlControls().filter((control) =>
      control.body.includes('xsi:type="ShowTaskpane"'),
    );

    expect(showTaskpane.length).toBeGreaterThan(0);
    expect(showTaskpane.map((control) => control.id).sort()).toEqual([
      "ToneForgeSemanticContextControl",
      "ToneForgeTaskpane",
    ]);
  });

  it("routes the remaining XML controls through a function, naming no pane", () => {
    const openers = new Set(["ToneForgeTaskpane", "ToneForgeSemanticContextControl"]);
    const actionControls = xmlControls().filter((control) => !openers.has(control.id));

    expect(actionControls.length).toBeGreaterThan(0);
    actionControls.forEach((control) => {
      expect(control.body, `${control.id} must run a function`).toContain(
        'xsi:type="ExecuteFunction"',
      );
    });
  });

  /**
   * ONE shared identity, and this is the assertion that had it backwards twice.
   *
   * Microsoft documents sharing an id as the normal pattern: "Use the same
   * TaskpaneId for different actions that share the same pane... the pane
   * container will remain open." A *different* id is an independent pane.
   *
   * This check once asserted that no control may name a pane at all, which is
   * what ADR-0104 did and what caused the second pane: with no id, two
   * ShowTaskpane actions are two independent panes, confirmed in a real Word as
   * the context menu and the ribbon each opening their own instance.
   */
  it("gives every pane command the same pane identity", () => {
    // Read with comments stripped, for the reason in this file's header: the
    // manifest explains this very rule inline, and prose naming the element is
    // not the element.
    const identities = liveControls()
      .filter((control) => control.body.includes('xsi:type="ShowTaskpane"'))
      .map((control) => /<TaskpaneId>([^<]+)<\/TaskpaneId>/.exec(control.body)?.[1]);

    expect(identities.length).toBeGreaterThan(0);
    expect(new Set(identities)).toEqual(new Set(["ButtonId1"]));
  });

  it("lets no function command name a pane, because only a pane command does", () => {
    const openers = new Set(["ToneForgeTaskpane", "ToneForgeSemanticContextControl"]);
    liveControls()
      .filter((control) => control.id.startsWith("ToneForge") && !openers.has(control.id))
      .forEach((control) => {
        expect(control.body, `${control.id} must not name a taskpane`).not.toContain("TaskpaneId");
      });
  });

  /**
   * The two openers name DIFFERENT pages of the one pane, and that is the fix.
   *
   * Microsoft, on the Action element: commands sharing a `TaskpaneId` keep "the
   * pane container open but the contents of the pane will be replaced with the
   * corresponding Action SourceLocation". So the source location is how a task
   * pane command \u2014 which runs no JavaScript of ours, and therefore cannot carry
   * an instruction \u2014 reaches a particular page (ADR-0109).
   *
   * This assertion once demanded one source for both openers, which would have
   * forbidden the deep link and forced the context menu to open the landing page
   * instead. It is inverted here for the same reason the identity rule was: the
   * thing that must be unique is the PANE, and the pane is named by the
   * `TaskpaneId`, which the previous test asserts.
   */
  it("opens a different PAGE per opener, and every page resolves", () => {
    const pages = panePages();

    expect(pages.size).toBeGreaterThan(0);
    // A resid with no resource never resolves, and the host opens nothing
    // silently \u2014 the same failure shape as an over-length resource id (ADR-0082).
    expect([...pages.values()].every((page) => page.endsWith(".html"))).toBe(true);
    expect(pages.get("ToneForgeTaskpane")).toMatch(/\/taskpane\.html$/);
    expect(pages.get("ToneForgeSemanticContextControl")).toMatch(/\/semantic\.html$/);
    expect(new Set(pages.values()).size).toBe(pages.size);
  });

  it("serves every pane page from the one origin the manifest declares", () => {
    const origins = new Set([...panePages().values()].map((page) => new URL(page).origin));

    expect(origins.size).toBe(1);
  });

  it("declares the shared runtime the pane belongs to", () => {
    // The pane identity is only meaningful in a shared runtime, so the manifest
    // has to actually declare one \u2014 otherwise this file is asserting a property
    // of markup that is not there.
    expect(xml).toMatch(/<Runtime\b[^>]*\blifetime="long"/);
    expect(xml).toContain("SharedRuntime");
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
