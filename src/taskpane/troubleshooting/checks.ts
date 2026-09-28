/**
 * The one place that knows why the pane is not doing what someone expects.
 *
 * This was a single function inside the troubleshooting panel, which meant the
 * panel could answer the question only if the user had already found the panel.
 * Every other surface that refuses an action — Apply, the semantic rewrite, the
 * ribbon button — knows the reason and was repeating it in its own words, or
 * not saying it at all.
 *
 * Two rules make this a registry rather than a list of strings:
 *
 * 1. **Every remedy names its target.** Not "check your settings" — the actual
 *    control, by the label the user will find on screen, and the page it lives
 *    on. A remedy that does not say where to go is the same non-answer the
 *    panel was already giving, one level of indirection further away.
 *
 * 2. **Only true situations are returned.** A page people arrive at *because
 *    something is wrong* that lists every possible symptom makes the one line
 *    that matters indistinguishable from the four that do not apply.
 *
 * Pure by construction: state in, notes out. Nothing here reads the store, so
 * any surface can call it, and a check cannot disagree with itself.
 */
import type { CoverageReport } from "../../core/domain/DocumentSnapshot";

/**
 * Where a remedy actually lives.
 *
 * A label rather than a navigation target, deliberately. The pane's own
 * destinations (`TaskPaneDestination`) and the command layer's
 * (`TaskpaneTarget`) are different unions with no mapping between them, and
 * inventing one to make these buttons work would couple this registry to the
 * Dashboard for no gain: the user still has to find the control on the page
 * they are sent to. Naming the control precisely is what makes the remedy
 * actionable; a link that lands them one screen early is not.
 */
export interface RemedyTarget {
  /**
   * The full path as the user walks it, e.g.
   * "Settings → Scanning → Scan automatically as the document changes".
   */
  label: string;
}

/** One situation the user is actually in, with what to do about it. */
export interface TroubleshootingNote {
  id: string;
  /** How it presents, in the user's words rather than the product's. */
  situation: string;
  cause: string;
  remedy: string;
  remedyTarget: RemedyTarget;
}

export interface TroubleshootingInput {
  autoScan: boolean;
  trackedEditing: boolean;
  coverage: CoverageReport | null;
  /** A semantic profile is in effect, so the rewrite has a voice to match. */
  semanticProfileActive: boolean;
  /** A provider is configured and reachable enough to send a request to. */
  providerConfigured: boolean;
  /**
   * Raw-text consent, as currently saved.
   *
   * Read rather than assumed, because it is a decision the user can withdraw
   * in Settings while every other prerequisite stays true. A panel that listed
   * the missing provider but not the withdrawn consent would send someone to
   * configure something they already have.
   */
  rawTextConsent: boolean;
  /** Changes queued in the plan, and how many of them the user has reviewed. */
  plannedCount: number;
  reviewedCount: number;
}

/**
 * Text that may need the state to phrase itself.
 *
 * A cause that says "3 changes are waiting" has to be built from the input, and
 * hard-coding the number in a registry that outlives the session it was written
 * for is a way to state something false. Only one entry needs this; the rest
 * are plain strings so the common case stays readable.
 */
type CheckText = string | ((input: TroubleshootingInput) => string);

interface TroubleshootingCheck {
  id: string;
  appliesTo: (input: TroubleshootingInput) => boolean;
  situation: string;
  cause: CheckText;
  remedy: CheckText;
  remedyTarget: RemedyTarget;
}

function resolve(text: CheckText, input: TroubleshootingInput): string {
  return typeof text === "string" ? text : text(input);
}

/**
 * Ordered by how often it turns out to be the answer, not by id.
 *
 * The first two account for most visits: the pane looks idle, or the one
 * button that writes to the document is greyed out. Coverage last, because it
 * is the only one that is a property of the document rather than of a setting.
 */
const CHECKS: readonly TroubleshootingCheck[] = [
  {
    id: "auto-scan-off",
    appliesTo: (input) => input.autoScan === false,
    situation: "Findings stop updating while I type",
    cause:
      "Automatic scanning is switched off. ToneForge is not watching the document, so nothing it has not already read can change.",
    remedy:
      "Switch it back on, or press Re-scan now on Document Governance. The manual scan is not affected by this setting, and the findings and pending changes you already have are not affected either.",
    remedyTarget: {
      label: "Settings → Scanning → Scan automatically as the document changes",
    },
  },
  {
    id: "tracked-editing-off",
    appliesTo: (input) => input.trackedEditing === false,
    situation: "Apply is refused, or the host says tracked changes are unavailable",
    cause:
      "Tracked editing is not enabled for this host. ToneForge will not write a change it cannot record as a reviewable Word revision — Track Changes cannot be bypassed.",
    remedy:
      "Enable it. The host probe runs as part of the change, so this one also tells you whether this Word can support tracked changes at all.",
    remedyTarget: {
      label: "Settings → Tracked editing → Allow ToneForge to apply tracked changes",
    },
  },
  {
    id: "nothing-reviewed",
    appliesTo: (input) => input.plannedCount > 0 && input.reviewedCount === 0,
    situation: "Apply is unavailable even though there are pending changes",
    cause: (input) =>
      `Apply writes only the findings you have reviewed. ${
        input.plannedCount === 1
          ? "One change is waiting"
          : `${input.plannedCount} changes are waiting`
      }, and none has been marked reviewed yet. This is deliberate: ToneForge will not write a change you have not looked at.`,
    remedy:
      "Mark each finding you want applied with Review, then Apply becomes available for exactly those findings and no others.",
    remedyTarget: {
      label: "Document Governance → Findings → Review on each finding you want applied",
    },
  },
  {
    id: "no-semantic-profile",
    appliesTo: (input) => input.semanticProfileActive === false,
    situation:
      "The Semantic tab has no measured style, and the ribbon's semantic button is greyed out",
    cause:
      "A semantic profile says how the writing should sound, so with none active there is nothing to measure, nothing to edit, and no voice for a rewrite to match.",
    remedy:
      "Create one on the Semantic tab. Learn Style needs a sample of a few paragraphs; Create empty profile gives you a blank one to fill in by hand, with no sample and no provider involved.",
    remedyTarget: {
      label: "Semantic → Semantic profiles → Create empty profile",
    },
  },
  {
    id: "no-provider",
    appliesTo: (input) => input.providerConfigured === false,
    situation: "The semantic rewrite and AI Review are unavailable",
    cause:
      "No AI provider is configured. The deterministic checks and the whole Document Governance review still work; only the parts that send your text to a model are unavailable.",
    remedy:
      "Add a provider and a key. Nothing is sent anywhere until you also allow it — the two permissions are separate and both are yours to grant.",
    remedyTarget: {
      label: "Settings → Provider and privacy → Provider, then enter the key",
    },
  },
  {
    id: "no-raw-text-consent",
    appliesTo: (input) =>
      input.rawTextConsent === false && input.providerConfigured && input.semanticProfileActive,
    situation: "The semantic rewrite is unavailable even though everything else is set up",
    cause:
      "Sending your text to a provider is switched off. The provider and the semantic profile are both ready, so nothing else is missing — the rewrite is refused because that one permission has not been granted.",
    remedy:
      "Turn it on. Nothing is sent anywhere until you do, and you can withdraw it again in Settings at any time.",
    remedyTarget: {
      label: "Settings → Provider and privacy → Allow semantic analysis",
    },
  },
  {
    id: "coverage-incomplete",
    appliesTo: (input) => input.coverage !== null && input.coverage.complete === false,
    situation: "There are fewer findings than I expected",
    cause:
      "Coverage is incomplete: some or all of the in-scope text was not checked, so the findings shown are an unknown subset of the problems present rather than a shorter list of them.",
    remedy:
      "Read Analysis coverage diagnostics below for exactly which parts were skipped and why. Anything listed under unsupported is a host limitation, not something a setting here will change.",
    remedyTarget: {
      label: "Troubleshooting → Analysis coverage diagnostics",
    },
  },
];

/** The situations currently true, most likely first. */
export function diagnoseSituation(input: TroubleshootingInput): TroubleshootingNote[] {
  return CHECKS.filter((check) => check.appliesTo(input)).map((check) => ({
    id: check.id,
    situation: check.situation,
    cause: resolve(check.cause, input),
    remedy: resolve(check.remedy, input),
    remedyTarget: check.remedyTarget,
  }));
}

/** The ids of every situation this registry can report, whether true or not. */
export function troubleshootingCheckIds(): readonly string[] {
  return CHECKS.map((check) => check.id);
}
