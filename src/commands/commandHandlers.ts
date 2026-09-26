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

/**
 * Both review commands open the single AI Review page.
 *
 * They used to probe the host, read the selection, and route to one of three
 * different targets, which meant a ribbon click could open the pane part-way
 * into a review whose disclosure the user had not seen. The pane now always
 * shows the disclosure first and starts nothing until the user chooses to.
 */
export async function reviewSelection(): Promise<void> {
  await showTaskpane("ai-review");
}

export async function reviewDocument(): Promise<void> {
  await showTaskpane("ai-review");
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
