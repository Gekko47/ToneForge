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
    caps.hostName = normalizeHostName(ctx?.hostName);
    caps.hostVersion = ctx?.hostVersion ?? null;
  } catch {
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
          return (
            range !== null && hasMethod(range, "insertBreak") && hasOfficeInsertBreakBehavior()
          );
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
          const items = (styles as unknown as { items?: unknown[] }).items;
          return Array.isArray(items) && items.length > 0;
        });
        return result === true;
      },
    ],
    [
      "supportsRevisions",
      async () => {
        const result = await runInWordSafe(async (context) => {
          const anyContext = context as unknown as {
            document?: {
              trackedChanges?: unknown;
            };
          };
          const tracked = anyContext.document?.trackedChanges;
          if (!tracked) return false;
          const trackedChanges = tracked as { load?: unknown; items?: unknown };
          if (typeof trackedChanges.load !== "function") return false;
          trackedChanges.load("items");
          await context.sync();
          return Array.isArray(trackedChanges.items);
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
    const range = selection.getRange(0, 0);
    return range;
  } catch {
    return null;
  }
}

function hasMethod(target: unknown, methodName: string): boolean {
  return typeof (target as { [key: string]: unknown })[methodName] === "function";
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
