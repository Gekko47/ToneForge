import { z } from "zod";
import type { TaskpaneTarget } from "../shared/office/taskpaneNavigation";
import commandDefinitionData from "./commandDefinitions.json";
import {
  editProfile,
  openFindings,
  openPendingChanges,
  openProfile,
  reviewDocument,
  reviewSelection,
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
    "governance",
    "findings",
    "ai-review-selection",
    "ai-review-paragraph",
    "ai-review-document",
    "profile",
    "pending-changes",
  ]),
});

const commandDefinitions = z.array(CommandDefinitionSchema).parse(commandDefinitionData);
const handlers: Readonly<Record<(typeof commandDefinitions)[number]["id"], CommandHandler>> = {
  ToneForgeScan: scanNow,
  ToneForgeFindings: openFindings,
  ToneForgeReviewSelection: reviewSelection,
  ToneForgeReviewDocument: reviewDocument,
  ToneForgeActiveProfile: openProfile,
  ToneForgeEditProfile: editProfile,
  ToneForgePendingChanges: openPendingChanges,
};

export const COMMAND_REGISTRY = commandDefinitions.map((definition): CommandDefinition => {
  const handler = handlers[definition.id];
  if (!handler) {
    throw new Error(`Command handler is missing: ${definition.id}`);
  }
  return { ...definition, handler };
});
