import { setTaskpaneTarget, type TaskpaneTarget } from "../shared/office/taskpaneNavigation";

async function showTaskpane(target: TaskpaneTarget, action?: "scan"): Promise<void> {
  setTaskpaneTarget(target, action);
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
 * Open AI Review and wait.
 *
 * There is one review surface and it starts nothing on arrival. The pane shows
 * the disclosure — scope, provider, and what a model may get wrong — and the
 * user chooses to run it.
 */
export async function reviewForConsistency(): Promise<void> {
  await showTaskpane("ai-review");
}

export async function openProfile(): Promise<void> {
  await showTaskpane("profile");
}

/**
 * Open the Governance Policy tab and wait.
 *
 * Policy authoring touches protected-setting flags, so this deliberately does
 * not start anything: the page must render the current policy before a person
 * can change what Apply is permitted to do.
 */
export async function openGovernancePolicy(): Promise<void> {
  await showTaskpane("governance-policy");
}

export async function openPendingChanges(): Promise<void> {
  await showTaskpane("pending-changes");
}

/**
 * Open the governance page and actually scan.
 *
 * This command previously only opened the pane, so a user who pressed a button
 * labelled "Scan Now" got a page and had to press Scan a second time. The
 * request travels with the navigation, and the pane runs it on arrival.
 */
export async function scanNow(): Promise<void> {
  await showTaskpane("governance", "scan");
}

export async function openTroubleshooting(): Promise<void> {
  await showTaskpane("debugging");
}
