/**
 * Ribbon availability for the semantic controls.
 *
 * The semantic rewrite is meaningless without a semantic profile to match
 * against: the prompt sends the profile to the model, and with no profile there
 * is nothing to send. So the control is declared `"enabled": false` in the
 * manifest and turned on here, only once a profile actually exists.
 *
 * Two things this file deliberately does not do:
 *
 * - It does not decide the *outcome*. `semanticButtonEnabled` is pure, so the
 *   rule is testable without an Office host, and the host call is a thin shell
 *   around it.
 * - It does not assume the update succeeded. Office documents that
 *   `requestUpdate` resolves once the request is *queued*, not once the ribbon
 *   has repainted, and that it rejects with `HostRestartNeeded` when the add-in
 *   was just upgraded. A caller that assumed success would leave the button
 *   showing a state the ribbon does not have.
 *
 * `requestUpdate` is only reachable from a shared runtime, which is why the
 * manifest declares `lifetime: "long"` on the commands runtime. On a host
 * without `Office.ribbon`, this is a no-op rather than an error: the control
 * stays in the state the manifest gave it, which is the safe direction.
 */

import { logger } from "../shared/utils/logger";

/**
 * The control ids this module owns. They must match the manifest exactly.
 *
 * The group is `ToneForgeProfileGroup` rather than `ToneForgeProfile` because a
 * ribbon surface requires every UI element id to be unique, and the group
 * contains a control with the shorter name. Sharing it made Word refuse the
 * whole manifest, which presented as "This add-in is no longer available" with
 * no ribbon at all. See ADR-0082.
 */
export const SEMANTIC_RIBBON_TAB = "ToneForge";
export const SEMANTIC_RIBBON_GROUP = "ToneForgeProfileGroup";
export const SEMANTIC_RIBBON_CONTROL = "ToneForgeSemanticControl";

/**
 * Whether the semantic ribbon control should be enabled.
 *
 * Pure. The one rule is that a profile must exist — a profile with no draft and
 * no active published version is a record that exists but cannot describe a
 * voice, so it does not count.
 */
export function semanticButtonEnabled(hasUsableProfile: boolean): boolean {
  return hasUsableProfile === true;
}

function ribbonRequestUpdate(): ((data: unknown) => Promise<void>) | null {
  const office = (
    globalThis as {
      Office?: { ribbon?: { requestUpdate?: (data: unknown) => Promise<void> } };
    }
  ).Office;
  const request = office?.ribbon?.requestUpdate;
  return typeof request === "function"
    ? (request as (data: unknown) => Promise<void>).bind(office?.ribbon)
    : null;
}

/**
 * Reflect the semantic profile's existence in the ribbon.
 *
 * Returns whether the request was accepted by the host, not whether the ribbon
 * has repainted — see the module note.
 */
export async function syncSemanticRibbon(hasUsableProfile: boolean): Promise<boolean> {
  const enabled = semanticButtonEnabled(hasUsableProfile);
  const request = ribbonRequestUpdate();
  if (request === null) {
    // Not an error: an older host simply keeps the manifest's disabled state.
    return false;
  }
  try {
    await request({
      tabs: [
        {
          id: SEMANTIC_RIBBON_TAB,
          groups: [
            {
              id: SEMANTIC_RIBBON_GROUP,
              controls: [{ id: SEMANTIC_RIBBON_CONTROL, enabled }],
            },
          ],
        },
      ],
    });
    return true;
  } catch (error: unknown) {
    // `HostRestartNeeded` is the documented outcome after an add-in upgrade, and
    // it is not actionable from here. Anything else is worth seeing.
    const code = (error as { code?: unknown } | null)?.code;
    if (code !== "HostRestartNeeded") {
      logger.warn("Could not update the semantic ribbon control", { error });
    }
    return false;
  }
}
