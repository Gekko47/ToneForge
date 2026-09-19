/**
 * Stage 01 hard gate: probe Word capabilities BEFORE building the reformatter.
 * Exposes a single, testable probe that the rest of the codebase depends on.
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
 * Probe the host by attempting each primitive. Failures are caught and
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
    caps.hostName = (ctx?.hostName as WordCapabilities["hostName"]) ?? "unknown";
    caps.hostVersion = ctx?.hostVersion ?? null;
  } catch {
    return caps;
  }

  const probes: Array<[keyof WordCapabilities, () => Promise<boolean>]> = [
    [
      "supportsInsertText",
      async () => {
        await runInWord(async (context) => {
          context.document.getSelection().insertText("ToneForge probe", "Replace");
        });
        return true;
      },
    ],
    [
      "supportsReplaceText",
      async () => {
        await runInWord(async (context) => {
          const range = context.document.getSelection();
          range.load("text");
          await context.sync();
          if (range.text?.includes("ToneForge probe")) {
            range.insertText("", "Replace");
          }
        });
        return true;
      },
    ],
    [
      "supportsInsertParagraph",
      async () => {
        await runInWord(async (context) => {
          const para = context.document.getSelection().insertParagraph("");
          para.load("text");
          await context.sync();
        });
        return true;
      },
    ],
    [
      "supportsInsertBreak",
      async () => {
        await runInWord(async (context) => {
          context.document.getSelection().insertBreak(Office.InsertBreakBehavior.Paragraph);
        });
        return true;
      },
    ],
    [
      "supportsStyles",
      async () => {
        await runInWord(async (context) => {
          const styles = context.document.styles;
          styles.load("name");
          await context.sync();
          return styles.items.length > 0;
        });
        return true;
      },
    ],
    [
      "supportsRevisions",
      async () => {
        await runInWord(async (context) => {
          const anyContext = context as unknown as {
            document?: {
              trackedChanges?: { load: (p: string) => void; items: unknown[] };
            };
          };
          const tracked = anyContext.document?.trackedChanges;
          if (tracked) {
            tracked.load("items");
            await context.sync();
          }
        });
        return true;
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
