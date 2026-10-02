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
  /**
   * What the XML manifest does for this control.
   *
   * **`ExecuteFunction`, and that is the change.** It was `ShowTaskpane`, which
   * meant the XML ribbon opened `TaskpaneId` `ButtonId1` while the XML context
   * menu ran a function and reached the *default* pane: two identities for one
   * add-in, and Word opened a second blank pane beside the live one. Both
   * manifests now run the same function, so `jsonAction` and `xmlAction` agree
   * \u2014 which is what ADR-0070 has been asking for and this field is what makes it
   * checkable rather than aspirational. (ADR-0101.)
   */
  readonly xmlAction: "ExecuteFunction";
  readonly navigationTarget: TaskpaneTarget;
  /** XML cannot encode command-specific targets; all XML controls use the default pane. */
  readonly xmlNavigationTarget: "default";
  readonly handler: CommandHandler;
}

const CommandDefinitionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  jsonAction: z.literal("executeFunction"),
  xmlAction: z.literal("ExecuteFunction"),
  /**
   * Still `"default"`, and now load-bearing rather than a note: every control
   * reaches the one pane the entry point declares, because none of them names
   * a pane of its own. (ADR-0101.)
   */
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
