/**
 * Setup status — what is ready, and what each missing piece is actually
 * preventing.
 *
 * This exists because the first-run experience used to answer the question "may
 * the user do anything?" rather than "what may they not do yet?". A page that
 * locks the whole pane until a profile exists is a worse answer than a page that
 * says "scanning is unavailable until you create a deterministic style profile,
 * and here is the button" — because the second one is still true when the user
 * also wants to read the AI consent, look at Troubleshooting, or set the theme.
 *
 * Two rules shape the shape of this module:
 *
 * 1. **A warning is not a capability grant.** Every entry says what is
 *    *unavailable*, never what becomes available. "Scanning and applying are
 *    unavailable" is a fact; "you can now scan" is a claim the module cannot
 *    make, because whether a gate opens is the gate's decision, not this one's.
 * 2. **Absence of a provider never blocks deterministic work.** The deterministic
 *    engine calls no model, so a missing provider blocks exactly the AI surfaces
 *    and nothing else. Claiming otherwise would teach users that the tool is
 *    broken when it is not.
 *
 * Pure: state in, description out. No React, no Office, no storage, so every
 * statement this makes can be pinned by a test without a host.
 */

import type { PersistedState } from "../core/state/persistence";
import { isRemoteProviderConfigured } from "./settings/providerComposition";

/** One thing the user can set up, and what its absence costs. */
export interface SetupItem {
  id: SetupItemId;
  /** The label the user reads, matching the page and control it points at. */
  label: string;
  ready: boolean;
  /**
   * What is unavailable until this is set up, in one sentence.
   *
   * `null` when ready. Never a promise of what becomes available: see rule 1
   * above.
   */
  blocked: string | null;
  /** Where the user goes to fix it. Named by destination, not by a URL. */
  destination: SetupDestination;
  /** The control on that page, by its on-screen label. */
  control: string;
}

export type SetupItemId = "deterministicProfile" | "semanticProfile" | "llmProvider";

export type SetupDestination = "profile" | "semantic" | "settings";

export interface SetupStatus {
  items: readonly SetupItem[];
  /** True when nothing is outstanding. Drives the Home page's own framing. */
  complete: boolean;
  /**
   * True when a deterministic profile is missing, which is the one prerequisite
   * that gates whole capabilities rather than individual surfaces.
   */
  blocksScanning: boolean;
}

/**
 * Build the checklist from persisted state.
 *
 * `providerUsable` is injected rather than derived here so this module stays free
 * of provider construction — the caller already has the answer, and a second
 * derivation would be a second thing that can disagree about whether a provider
 * is configured.
 */
export function setupStatus(state: PersistedState, providerUsable: boolean): SetupStatus {
  const deterministicReady = state.activeProfileId !== null;
  const semanticReady = state.activeSemanticProfileId !== null;

  const items: SetupItem[] = [
    {
      id: "deterministicProfile",
      label: "Deterministic style profile",
      ready: deterministicReady,
      blocked: deterministicReady
        ? null
        : "Scanning this document and applying corrections are unavailable until a deterministic " +
          "style profile exists, because every deterministic check is measured against one.",
      destination: "profile",
      control: "Deterministic Style Profile → Save profile",
    },
    {
      id: "semanticProfile",
      label: "Semantic style profile",
      ready: semanticReady,
      blocked: semanticReady
        ? null
        : "Semantic rewrite and the measured-style comparison are unavailable until a semantic " +
          "style profile exists. Create an empty one by hand, or run Learn Style on a sample.",
      destination: "semantic",
      control: "Semantic → Semantic profiles → Create empty profile",
    },
    {
      id: "llmProvider",
      label: "AI provider",
      ready: providerUsable,
      blocked: providerUsable
        ? null
        : "The consistency check and the semantic rewrite are unavailable until a provider is " +
          "connected. Deterministic review, scanning, and applying corrections are unaffected.",
      destination: "settings",
      control: "Settings → Provider and privacy → Provider",
    },
  ];

  return {
    items,
    complete: items.every((item) => item.ready),
    blocksScanning: !deterministicReady,
  };
}

/** Convenience wrapper that reads provider availability the same way Settings does. */
export function setupStatusFromState(state: PersistedState): SetupStatus {
  return setupStatus(state, isRemoteProviderConfigured(state.settings, state.providerConnections));
}

/**
 * Whether a capability is currently available, given the checklist.
 *
 * Expressed as named capabilities rather than as "is the checklist complete",
 * because the three items gate different things. A user with no provider can
 * still scan and apply; a user with no semantic profile can still do everything
 * except rewrite. Collapsing that to one boolean is what produced a first run
 * that felt entirely switched off.
 */
export type Capability =
  "scan" | "apply" | "consistencyReview" | "semanticRewrite" | "governancePolicy";

/**
 * A list rather than one item, because a capability can need more than one thing.
 *
 * One id per capability could not express the consistency review's two real
 * prerequisites, and naming only the deterministic profile reported it available
 * with no provider — which is the configuration in which the run fails.
 */
const CAPABILITY_ITEMS: Readonly<Record<Capability, readonly SetupItemId[]>> = {
  scan: ["deterministicProfile"],
  apply: ["deterministicProfile"],
  // The consistency engine compares the document against itself. It needs a
  // deterministic profile for the governing policy and a provider for
  // adjudication, so both are real prerequisites rather than assumed ones.
  consistencyReview: ["deterministicProfile", "llmProvider"],
  semanticRewrite: ["semanticProfile"],
  governancePolicy: ["deterministicProfile"],
};

export function capabilityAvailable(
  status: SetupStatus,
  capability: Capability,
): { available: boolean; reason: string | null } {
  // The first unmet prerequisite, in the declared order, so the refusal names one
  // concrete thing rather than every thing at once.
  const unmet = CAPABILITY_ITEMS[capability]
    .map((id) => status.items.find((item) => item.id === id))
    .find((item) => item !== undefined && !item.ready);
  if (unmet === undefined || unmet.ready) return { available: true, reason: null };
  return { available: false, reason: unmet.blocked };
}
