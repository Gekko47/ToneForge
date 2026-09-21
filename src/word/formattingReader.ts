/**
 * Live formatting reader.
 *
 * Reads Word paragraph styles and direct formatting via `runInWord` and
 * returns a plain `FormattingSnapshot` DTO. All Office.js access is
 * isolated here so the pure `src/formatting/` engine stays dependency-free.
 *
 * Read-only: never mutates the document. Safe to run on any document.
 * Graceful degradation: returns an empty snapshot when the Office runtime
 * is unavailable or the host does not support the requested object model.
 *
 * Boundary rule: this file lives in `src/word/` and may import from
 * `shared/office`, `core/domain`, and `shared/utils` only.
 */

import { runInWord } from "../shared/office/officeHelpers";
import { hashDocument } from "./documentReader";
import type { FormattingSnapshot } from "../formatting/formattingSnapshot";

export interface FormattingReadOptions {
  maxChars?: number;
}

/** Read the live document formatting and return a DTO snapshot. */
export async function getFormattingSnapshot(
  options: FormattingReadOptions = {},
): Promise<FormattingSnapshot> {
  const maxChars = options.maxChars ?? 500_000;

  try {
    return await runInWord(async (context) => {
      const body = context.document.body;
      body.load("text");
      await context.sync();
      const fullText = body.text ?? "";
      const text = fullText.length > maxChars ? fullText.slice(0, maxChars) : fullText;

      const anyContext = context as unknown as {
        document?: {
          id?: string;
          body?: {
            paragraphs?: {
              load: (prop: string) => unknown;
              items: unknown[];
            };
          };
        };
      };
      const docId = anyContext.document?.id ?? hashDocument(fullText);

      const paragraphs: FormattingSnapshot["paragraphs"] = [];
      const paraCollection = anyContext.document?.body?.paragraphs;
      if (paraCollection && typeof paraCollection.load === "function") {
        paraCollection.load("items");
        await context.sync();
      }
      if (paraCollection && Array.isArray(paraCollection.items)) {
        const items = paraCollection.items;

        // Load properties on every paragraph before reading them. Without
        // this second sync, paragraph.text/style/format/font are still
        // proxies and resolve to empty values in a real Word host.
        items.forEach((item) => {
          if (!item || typeof item !== "object") return;
          const para = item as { load?: (prop: string) => unknown };
          if (typeof para.load === "function") {
            para.load("text");
            para.load("style");
            para.load("format");
            para.load("font");
          }
        });
        await context.sync();

        items.forEach((item, i) => {
          if (!item || typeof item !== "object") return;
          const para = item as {
            text?: string;
            style?: { name?: string };
            format?: {
              alignment?: string;
              lineSpacing?: number;
              spaceAfter?: number;
              spaceBefore?: number;
            };
            font?: {
              name?: string;
              size?: number;
              color?: string;
              bold?: boolean;
              italic?: boolean;
              underline?: boolean;
            };
          };
          const font = para.font ?? {};
          paragraphs.push({
            index: i,
            text: typeof para.text === "string" ? para.text : "",
            styleName:
              typeof para.style?.name === "string" && para.style.name.length > 0
                ? para.style.name
                : "Normal",
            alignment: normalizeAlignment(para.format?.alignment),
            lineSpacing:
              typeof para.format?.lineSpacing === "number" ? para.format.lineSpacing : null,
            spaceAfter: typeof para.format?.spaceAfter === "number" ? para.format.spaceAfter : null,
            spaceBefore:
              typeof para.format?.spaceBefore === "number" ? para.format.spaceBefore : null,
            listLevel: null,
            fontName: typeof font.name === "string" && font.name.length > 0 ? font.name : null,
            fontSize: typeof font.size === "number" ? font.size : null,
            fontColor: typeof font.color === "string" && font.color.length > 0 ? font.color : null,
            bold: typeof font.bold === "boolean" ? font.bold : null,
            italic: typeof font.italic === "boolean" ? font.italic : null,
            underline: typeof font.underline === "boolean" ? font.underline : null,
          });
        });
      }

      return {
        id: docId,
        text,
        paragraphs,
        capturedAt: new Date().toISOString(),
        hash: hashDocument(text),
      };
    });
  } catch {
    return {
      id: "unavailable",
      text: "",
      paragraphs: [],
      capturedAt: new Date().toISOString(),
    };
  }
}

function normalizeAlignment(value: unknown): FormattingSnapshot["paragraphs"][number]["alignment"] {
  if (typeof value !== "string") return null;
  switch (value.toLowerCase()) {
    case "left":
      return "left";
    case "center":
      return "center";
    case "right":
      return "right";
    case "justified":
      return "justified";
    default:
      return null;
  }
}
