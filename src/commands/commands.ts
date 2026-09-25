/**
 * Ribbon command runtime entry point.
 *
 * The typed registry is the single source for manifest action IDs, labels,
 * navigation destinations, and handlers. Commands only open task-pane views;
 * they never import the revision adapter or mutate the document.
 */

import { COMMAND_REGISTRY, type CommandEvent } from "./commandRegistry";

export * from "./commandHandlers";
export { COMMAND_REGISTRY } from "./commandRegistry";
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

const officeGlobal = (
  globalThis as unknown as {
    Office?: { onReady?: (callback: () => void) => void };
  }
).Office;
if (typeof officeGlobal?.onReady === "function") {
  officeGlobal.onReady(() => associateCommandActions());
}
