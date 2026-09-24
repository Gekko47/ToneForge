/**
 * Ribbon command entry points.
 *
 * Commands only choose a task-pane destination. They never import the
 * revision adapter and never mutate the Word document.
 */

import { getSelectionText } from "../word/documentReader";
import { probeWordCapabilities } from "../word/capabilityProbe";
import { setTaskpaneTarget, type TaskpaneTarget } from "../shared/office/taskpaneNavigation";

async function showTaskpane(target: TaskpaneTarget): Promise<void> {
  setTaskpaneTarget(target);
  const office = (
    globalThis as {
      Office?: { addin?: { showAsTaskpane?: () => Promise<void> } };
    }
  ).Office;
  try {
    await office?.addin?.showAsTaskpane?.();
  } catch {
    // The task pane can also be opened by the manifest openPage action.
  }
}

export async function openTaskpane(): Promise<void> {
  await showTaskpane("governance");
}

export async function openGovernance(): Promise<void> {
  await showTaskpane("governance");
}

export async function openFindings(): Promise<void> {
  await showTaskpane("findings");
}

export async function reviewSelection(): Promise<void> {
  try {
    const capabilities = await probeWordCapabilities();
    if (!capabilities.supportsSelection) {
      await showTaskpane("governance");
      return;
    }

    const selection = await getSelectionText();
    if (selection.trim().length > 0) {
      await showTaskpane("ai-review-selection");
      return;
    }

    await showTaskpane(
      capabilities.supportsParagraphResolution ? "ai-review-paragraph" : "governance",
    );
  } catch {
    await showTaskpane("governance");
  }
}

export async function reviewDocument(): Promise<void> {
  await showTaskpane("ai-review-document");
}

export async function openProfile(): Promise<void> {
  await showTaskpane("profile");
}

export async function editProfile(): Promise<void> {
  await showTaskpane("profile");
}

export async function openPendingChanges(): Promise<void> {
  await showTaskpane("pending-changes");
}

export async function scanNow(): Promise<void> {
  await showTaskpane("governance");
}

interface CommandEvent {
  completed(): void;
}

type CommandHandler = (event: CommandEvent) => Promise<void>;

const COMMAND_HANDLERS: Readonly<Record<string, () => Promise<void>>> = {
  ToneForgeScan: scanNow,
  ToneForgeFindings: openFindings,
  ToneForgeReviewSelection: reviewSelection,
  ToneForgeReviewDocument: reviewDocument,
  ToneForgeActiveProfile: openProfile,
  ToneForgeEditProfile: editProfile,
  ToneForgePendingChanges: openPendingChanges,
};

/** Associate every manifest executeFunction action with its navigation handler. */
export function associateCommandActions(): void {
  const office = (
    globalThis as {
      Office?: {
        actions?: { associate: (id: string, handler: CommandHandler) => void };
      };
    }
  ).Office;
  if (!office?.actions) return;
  Object.entries(COMMAND_HANDLERS).forEach(([id, handler]) => {
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
