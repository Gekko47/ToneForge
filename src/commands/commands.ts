/**
 * Ribbon command runtime entry point.
 *
 * The typed registry is the single source for manifest action IDs, labels,
 * navigation destinations, and handlers. Commands only open task-pane views;
 * they never import the revision adapter or mutate the document.
 */

import { COMMAND_REGISTRY, type CommandEvent } from "./commandRegistry";
import { syncSemanticRibbon } from "./ribbonState";
import { loadSemanticProfileRecord, loadState } from "../core/state/persistence";
import { effectiveProfile } from "../core/domain/ProfileRecord";

export * from "./commandHandlers";
export { COMMAND_REGISTRY, duplicateNavigationTargets } from "./commandRegistry";
export type { CommandDefinition, CommandEvent, CommandHandler } from "./commandRegistry";

/** Associate every JSON executeFunction action with its registered handler. */
export function associateCommandActions(): void {
  const office = (
    globalThis as {
      Office?: {
        actions?: {
          associate: (id: string, handler: (event: CommandEvent) => Promise<void>) => void;
        };
      };
    }
  ).Office;
  if (!office?.actions) return;
  COMMAND_REGISTRY.forEach(({ id, handler }) => {
    office.actions?.associate(id, async (event) => {
      try {
        await handler();
      } finally {
        event.completed();
      }
    });
  });
}

/**
 * Bring the semantic ribbon control in line with whether a profile exists.
 *
 * Runs once the shared runtime is ready rather than on a timer: the profile set
 * can change while Word is open, but the button is only reachable from the
 * ribbon, and the Semantic tab calls `syncSemanticRibbon` again whenever the
 * profile it is editing changes. This is the initial pass that covers a user who
 * already had a profile before opening a document.
 */
async function syncRibbonOnReady(): Promise<void> {
  const state = loadState();
  const active = state.activeSemanticProfileId;
  if (active === null) {
    await syncSemanticRibbon(false);
    return;
  }
  const record = loadSemanticProfileRecord(active);
  // A missing record and a record with nothing usable in it are both "no
  // profile", so the button stays off for both.
  await syncSemanticRibbon(record !== null && effectiveProfile(record) !== null);
}

const officeGlobal = (
  globalThis as unknown as {
    Office?: { onReady?: (callback: () => void) => void };
  }
).Office;
if (typeof officeGlobal?.onReady === "function") {
  officeGlobal.onReady(() => {
    associateCommandActions();
    void syncRibbonOnReady();
  });
}
