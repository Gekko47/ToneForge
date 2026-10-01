/**
 * The typed command registry: the single source for manifest action ids, labels,
 * navigation destinations and handlers.
 *
 * **One command per destination, and the build enforces it.**
 * `duplicateNavigationTargets()` fails when two commands claim one target, which
 * is why Semantic Style is a second *pane* destination reached from the drawer
 * and from the Review page rather than a second ribbon button (D10). The
 * alternative — a "Semantic Style" button — would either have needed a distinct
 * target or would have failed the check, and in both cases the user would see two
 * buttons for one feature.
 */

import { z } from "zod";
import type { TaskpaneTarget } from "../shared/office/taskpaneNavigation";
import commandDefinitionData from "./commandDefinitions.json";
import {
  openFindings,
  openGovernancePolicy,
  openPendingChanges,
  openProfile,
  openSemanticReview,
  openTroubleshooting,
  reviewForConsistency,
  scanNow,
} from "./commandHandlers";

export interface CommandEvent {
  completed(): void;
}

export type CommandHandler = () => Promise<void>;

export interface CommandDefinition {
  readonly id: string;
  readonly label: string;
  readonly jsonAction: "executeFunction";
  readonly xmlAction: "ShowTaskpane";
  readonly navigationTarget: TaskpaneTarget;
  /** XML cannot encode command-specific targets; all XML controls use the default pane. */
  readonly xmlNavigationTarget: "default";
  readonly handler: CommandHandler;
}

const CommandDefinitionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  jsonAction: z.literal("executeFunction"),
  xmlAction: z.literal("ShowTaskpane"),
  xmlNavigationTarget: z.literal("default"),
  navigationTarget: z.enum([
    "review",
    "findings",
    "ai-review",
    "profile",
    "governance-policy",
    "pending-changes",
    "debugging",
    "semantic-review",
  ]),
});

const commandDefinitions = z.array(CommandDefinitionSchema).parse(commandDefinitionData);
const handlers: Readonly<Record<(typeof commandDefinitions)[number]["id"], CommandHandler>> = {
  ToneForgeScan: scanNow,
  ToneForgeFindings: openFindings,
  ToneForgeReview: reviewForConsistency,
  ToneForgeProfile: openProfile,
  ToneForgeGovernancePolicy: openGovernancePolicy,
  ToneForgePendingChanges: openPendingChanges,
  ToneForgeTroubleshooting: openTroubleshooting,
  ToneForgeSemantic: openSemanticReview,
};

export const COMMAND_REGISTRY = commandDefinitions.map((definition): CommandDefinition => {
  const handler = handlers[definition.id];
  if (!handler) {
    throw new Error(`Command handler is missing: ${definition.id}`);
  }
  return { ...definition, handler };
});

/**
 * Navigation targets claimed by more than one command.
 *
 * Two ribbon buttons that open the same page are indistinguishable to the user
 * and misleading about what the add-in can do: "Active Profile" and "Edit
 * Profile" both opened the profile page, and "Review Selection" and "Review
 * Document" both opened a whole-document review that ignores the selection. This
 * is the machine-checked form of that defect, so the duplication cannot return
 * silently with a new pair of buttons.
 */
export function duplicateNavigationTargets(): string[][] {
  const byTarget = new Map<TaskpaneTarget, string[]>();
  commandDefinitions.forEach((definition) => {
    const ids = byTarget.get(definition.navigationTarget) ?? [];
    ids.push(definition.id);
    byTarget.set(definition.navigationTarget, ids);
  });
  return [...byTarget.values()].filter((ids) => ids.length > 1);
}
