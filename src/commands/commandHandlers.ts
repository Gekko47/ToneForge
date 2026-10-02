import {
  setTaskpaneTarget,
  type TaskpaneAction,
  type TaskpaneTarget,
} from "../shared/office/taskpaneNavigation";

async function showTaskpane(target: TaskpaneTarget, action?: TaskpaneAction): Promise<void> {
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
  await showTaskpane("review");
}

export async function openGovernance(): Promise<void> {
  await showTaskpane("review");
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
  await showTaskpane("review", "scan");
}

export async function openTroubleshooting(): Promise<void> {
  await showTaskpane("debugging");
}

/**
 * Open Semantic Review and read the live selection into it.
 *
 * This is the context-menu entry point. The user right-clicked *this text*, so
 * making them select it again would be asking them to repeat the gesture that
 * brought them here. Reading a selection is a local Word call — nothing is sent
 * anywhere — and the review still needs its own explicit click, so arriving here
 * has not started a request.
 *
 * Renamed from `openSemanticStyle` in P9. It never opened the style page; it
 * opened the page the semantic control was on, and the name followed the
 * command's old label ("Check Semantic Style") rather than what it did. The
 * handler and the target move together for that reason.
 */
export async function openSemanticReview(): Promise<void> {
  await showTaskpane("semantic-review", "read-selection");
}

/*
 * The names the XML manifest's `onAction` attribute calls.
 *
 * The XML manifest resolves `onAction` against a global on the function file's
 * window, not against the JSON action registry, so each alias has to exist under
 * exactly the name the manifest uses. They delegate rather than duplicating the
 * logic, so the two manifests cannot reach the pane by different routes.
 *
 * **Every ribbon control has one, which is the point.** Previously only
 * `ToneForgeSemantic` existed, because it was the only XML control that ran a
 * function: the other seven ribbon buttons used `ShowTaskpane` with
 * `TaskpaneId` `ButtonId1`, while the context menu ran a function and so reached
 * the *default* pane. Two identities for one add-in, and Word opened a second
 * blank pane beside the live one when the context menu was used. Aliasing all of
 * them lets every control share one pane, which is what ADR-0101 requires.
 */

export async function ToneForgeSemantic(): Promise<void> {
  await openSemanticReview();
}

export async function ToneForgeScan(): Promise<void> {
  await scanNow();
}

export async function ToneForgeFindings(): Promise<void> {
  await openFindings();
}

export async function ToneForgeReview(): Promise<void> {
  await reviewForConsistency();
}

export async function ToneForgeProfile(): Promise<void> {
  await openProfile();
}

export async function ToneForgeGovernancePolicy(): Promise<void> {
  await openGovernancePolicy();
}

export async function ToneForgePendingChanges(): Promise<void> {
  await openPendingChanges();
}

export async function ToneForgeTroubleshooting(): Promise<void> {
  await openTroubleshooting();
}
