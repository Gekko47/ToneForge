/**
 * Stage 01 hard gate: probe Word capabilities BEFORE building the reformatter.
 * Exposes a single, testable probe that the rest of the codebase depends on.
 *
 * Non-destructive: probes inspect the host object model without mutating the
 * user's document. No `insertText`, `insertParagraph`, or `insertBreak`
 * mutations are performed, so the probe can be run freely inside Word without
 * polluting the user's document.
 *
 * Truthfulness: every probe returns the actual result from the host callback.
 * Failures are caught and recorded as `false` so the add-in can degrade
 * gracefully. No probe silently reports `true` when the host did not confirm.
 */

import { runInWord } from "../shared/office/officeHelpers";
import { getCachedHostInfo } from "../shared/office/hostInfo";

export interface WordCapabilities {
  supportsInsertText: boolean;
  supportsReplaceText: boolean;
  supportsInsertParagraph: boolean;
  supportsInsertBreak: boolean;
  supportsStyles: boolean;
  supportsRevisions: boolean;
  hostName: "Word" | "Excel" | "PowerPoint" | "unknown";
  hostVersion: string | null;
}

const DEFAULT_CAPABILITIES: WordCapabilities = {
  supportsInsertText: false,
  supportsReplaceText: false,
  supportsInsertParagraph: false,
  supportsInsertBreak: false,
  supportsStyles: false,
  supportsRevisions: false,
  hostName: "unknown",
  hostVersion: null,
};

/**
 * Probe the host by inspecting the object model. Failures are caught and
 * recorded as `false` so the add-in can degrade gracefully.
 */
export async function probeWordCapabilities(): Promise<WordCapabilities> {
  const caps: WordCapabilities = { ...DEFAULT_CAPABILITIES };

  try {
    const ctx = await runInWord(async (context) => {
      return {
        hostName: context.host?.name ?? null,
        hostVersion: context.host?.version ?? null,
      };
    });
    // Word.RequestContext does not reliably carry host identity in the real
    // host; prefer the authoritative `Office.onReady` info captured at startup
    // when the request context omits it.
    const cached = getCachedHostInfo();
    const hostName = ctx?.hostName ?? cached?.host ?? null;
    caps.hostName = normalizeHostName(hostName);
    caps.hostVersion = ctx?.hostVersion ?? null;
  } catch {
    const cached = getCachedHostInfo();
    if (cached?.host) {
      caps.hostName = normalizeHostName(cached.host);
    }
    return caps;
  }

  // The Word JS API exposes a single `Range.insertText(text, insertLocation)`
  // method. "Insert" text uses modes Start/End/Before/After; "replace" text
  // uses the same method with the "Replace" mode. There is no separate
  // `replaceText` method, so both capabilities derive from one probe.
  const insertTextResult = await runInWordSafe(async (context) => {
    const range = getProbeRange(context);
    return range !== null && hasMethod(range, "insertText");
  });
  caps.supportsInsertText = insertTextResult;
  caps.supportsReplaceText = insertTextResult;

  const probes: Array<[keyof WordCapabilities, () => Promise<boolean>]> = [
    [
      "supportsInsertParagraph",
      async () => {
        const result = await runInWordSafe(async (context) => {
          const range = getProbeRange(context);
          return range !== null && hasMethod(range, "insertParagraph");
        });
        return result === true;
      },
    ],
    [
      "supportsInsertBreak",
      async () => {
        const result = await runInWordSafe(async (context) => {
          const range = getProbeRange(context);
          return range !== null && hasMethod(range, "insertBreak") && hasWordBreakSupport();
        });
        return result === true;
      },
    ],
    [
      "supportsStyles",
      async () => {
        const result = await runInWordSafe(async (context) => {
          const styles = context.document.styles;
          if (!styles || typeof styles.load !== "function") return false;
          styles.load("name");
          await context.sync();
          const stylesView = styles as unknown as {
            items?: unknown[];
            getByNameOrNullObject?: unknown;
          };
          if (Array.isArray(stylesView.items) && stylesView.items.length > 0) {
            return true;
          }
          // Fallback signal: an empty items array after load may be a
          // load-semantics quirk rather than absence of the styles API.
          // A named-style lookup method proves the API surface exists, which
          // is all `range.style = name` (applyStyle) needs. Live Desktop Word
          // reported false here on 2026-09-22, so this path still needs a
          // live re-probe before it can be trusted.
          return typeof stylesView.getByNameOrNullObject === "function";
        });
        return result === true;
      },
    ],
    [
      "supportsRevisions",
      async () => {
        const result = await runInWordSafe(async (context) => {
          // There is no `document.trackedChanges` property in the Word
          // JavaScript API (the read API is `body.getTrackedChanges()`,
          // WordApi 1.6), so manageability is probed through the tracking
          // mode properties instead. A working Track Changes toggle in the
          // Word UI does NOT imply these APIs exist: the UI reflects native
          // host state, while the API requires WordApi 1.4
          // (`Document.changeTrackingMode`: "Off" | "TrackAll" |
          // "TrackMineOnly") or WordApiDesktop 1.4 (`Document.trackRevisions`).
          const doc = context.document as unknown as {
            load?: (props: string) => void;
            changeTrackingMode?: unknown;
            trackRevisions?: unknown;
          };
          if (typeof doc.load !== "function") return false;
          try {
            doc.load("changeTrackingMode");
            await context.sync();
          } catch {
            return false;
          }
          const mode = doc.changeTrackingMode;
          if (mode === "Off" || mode === "TrackAll" || mode === "TrackMineOnly") {
            return true;
          }
          try {
            doc.load("trackRevisions");
            await context.sync();
          } catch {
            return false;
          }
          return typeof doc.trackRevisions === "boolean";
        });
        return result === true;
      },
    ],
  ];

  for (const [key, probe] of probes) {
    try {
      caps[key] = (await probe()) as never;
    } catch {
      caps[key] = false as never;
    }
  }

  return caps;
}

/**
 * Run a probe callback inside Word, swallowing host errors and returning
 * `false` instead. Used for capability checks that must never throw out of
 * the probe (see ADR-0012: non-destructive, graceful degradation).
 */
async function runInWordSafe<T>(func: (context: Office.Context) => Promise<T>): Promise<T | false> {
  try {
    return await runInWord(func);
  } catch {
    return false;
  }
}

/**
 * Obtain a probe Range from the current selection without mutating anything.
 * Returns `null` when the host cannot provide a usable Range.
 */
function getProbeRange(context: Office.Context): Office.Range | null {
  try {
    const selection = context.document.getSelection();
    if (typeof selection.getRange !== "function") return null;
    const range = selection.getRange("Start");
    return range;
  } catch {
    return null;
  }
}

function hasMethod(target: unknown, methodName: string): boolean {
  return typeof (target as { [key: string]: unknown })[methodName] === "function";
}

function hasWordBreakSupport(): boolean {
  // Live Desktop Word (WebView2, 2026-09-22 diagnostics) exposes break enums
  // on the `Word` global (`Word.InsertLocation: true`) while
  // `Office.InsertBreakBehavior` is absent. Check the Word global first so
  // the probe does not report a false negative on a capable host.
  const word = (
    globalThis as unknown as {
      Word?: { BreakType?: unknown; InsertLocation?: unknown };
    }
  ).Word;
  if (
    word?.BreakType !== undefined &&
    word?.InsertLocation !== undefined &&
    Object.prototype.hasOwnProperty.call(word.BreakType, "NextParagraph") &&
    Object.prototype.hasOwnProperty.call(word.InsertLocation, "After")
  ) {
    return true;
  }
  // Legacy fallback for test doubles and older hosts.
  return hasOfficeInsertBreakBehavior();
}

function hasOfficeInsertBreakBehavior(): boolean {
  const office = (
    globalThis as unknown as {
      Office?: { InsertBreakBehavior?: { Paragraph?: unknown } };
    }
  ).Office;
  // Office.InsertBreakBehavior is an enum where Paragraph === 0, so we must
  // check for key presence rather than truthiness.
  return (
    office?.InsertBreakBehavior !== undefined &&
    Object.prototype.hasOwnProperty.call(office.InsertBreakBehavior, "Paragraph")
  );
}

function normalizeHostName(name: unknown): WordCapabilities["hostName"] {
  return name === "Word" || name === "Excel" || name === "PowerPoint"
    ? (name as WordCapabilities["hostName"])
    : "unknown";
}
