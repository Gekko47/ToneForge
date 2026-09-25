/**
 * Read-only Word formatting boundary. Paragraph properties are loaded from
 * their documented locations on `Word.Paragraph`; this module never loads the
 * fabricated `Paragraph.format` property and never mutates Word.
 */

import { runInWord } from "../shared/office/officeHelpers";
import { hashDocument } from "./documentReader";
import { buildParagraphNodeId } from "../core/domain/DocumentSnapshot";
import type {
  FormattingParagraph,
  FormattingPropertyProvenance,
  FormattingSnapshot,
} from "../formatting/formattingSnapshot";

export interface FormattingReadOptions {
  maxChars?: number;
}

interface FontView {
  name?: string;
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

interface ParagraphView {
  text?: string;
  style?: string | { name?: string };
  alignment?: string;
  lineSpacing?: number;
  spaceAfter?: number;
  spaceBefore?: number;
  font?: FontView;
  listItem?: { level?: number };
  styleBuiltIn?: string;
  uniqueLocalId?: string;
  isListItem?: boolean;
  /** Legacy test/host compatibility only; production uses direct properties. */
  format?: { alignment?: string; lineSpacing?: number; spaceAfter?: number; spaceBefore?: number };
  load?: (properties: string | string[]) => unknown;
}

interface StyleView {
  name?: string;
  nameLocal?: string;
  font?: FontView;
  load?: (properties: string | string[]) => unknown;
}

export async function getFormattingSnapshot(
  options: FormattingReadOptions = {},
): Promise<FormattingSnapshot> {
  const maxChars = options.maxChars ?? 500_000;
  try {
    return await runInWord(async (context) => {
      const body = context.document.body;
      const paragraphs = body.paragraphs;
      const styles = context.document.styles;
      body.load("text");
      paragraphs?.load("items");
      styles?.load("items");
      await context.sync();

      const fullText = body.text ?? "";
      const text = fullText.slice(0, maxChars);
      const items = Array.isArray(paragraphs?.items) ? (paragraphs.items as ParagraphView[]) : [];
      const styleItems = Array.isArray(styles?.items) ? (styles.items as StyleView[]) : [];
      const unsupported = new Set<string>();

      items.forEach((paragraph) => {
        paragraph.load?.([
          "text",
          "style",
          "styleBuiltIn",
          "uniqueLocalId",
          "isListItem",
          "alignment",
          "lineSpacing",
          "spaceAfter",
          "spaceBefore",
          "font",
        ]);
      });
      styleItems.forEach((style) => style.load?.(["name", "nameLocal", "font"]));
      await context.sync();

      const styleByName = new Map(
        styleItems.map((style) => [style.nameLocal ?? style.name ?? "", style]),
      );
      const paragraphsDto: FormattingParagraph[] = items.map((paragraph, index) => {
        const styleName = paragraphStyleName(paragraph);
        const styleFormatting = styleByName.get(styleName)?.font ?? {};
        const paragraphUnsupported = new Set<string>();
        const listLevel = readListLevel(paragraph, paragraphUnsupported, unsupported);
        const provenance = deriveProvenance(paragraph, styleFormatting, paragraphUnsupported);
        const nodeId = buildParagraphNodeId({
          ...(paragraph.uniqueLocalId ? { uniqueLocalId: paragraph.uniqueLocalId } : {}),
          index,
          text: typeof paragraph.text === "string" ? paragraph.text : "",
        });
        return {
          index,
          nodeId,
          sourcePath: `body/paragraph/${index}`,
          text: typeof paragraph.text === "string" ? paragraph.text : "",
          styleName,
          alignment: normalizeAlignment(paragraph.alignment ?? paragraph.format?.alignment) ?? null,
          lineSpacing:
            typeof paragraph.lineSpacing === "number"
              ? paragraph.lineSpacing
              : typeof paragraph.format?.lineSpacing === "number"
                ? paragraph.format.lineSpacing
                : null,
          spaceAfter:
            typeof paragraph.spaceAfter === "number"
              ? paragraph.spaceAfter
              : typeof paragraph.format?.spaceAfter === "number"
                ? paragraph.format.spaceAfter
                : null,
          spaceBefore:
            typeof paragraph.spaceBefore === "number"
              ? paragraph.spaceBefore
              : typeof paragraph.format?.spaceBefore === "number"
                ? paragraph.format.spaceBefore
                : null,
          listLevel,
          fontName: fontValue(paragraph.font?.name),
          fontSize: typeof paragraph.font?.size === "number" ? paragraph.font.size : null,
          fontColor: fontValue(paragraph.font?.color),
          bold: typeof paragraph.font?.bold === "boolean" ? paragraph.font.bold : null,
          italic: typeof paragraph.font?.italic === "boolean" ? paragraph.font.italic : null,
          underline:
            typeof paragraph.font?.underline === "boolean" ? paragraph.font.underline : null,
          provenance,
          styleFormatting: {
            fontName: fontValue(styleFormatting.name),
            fontSize: typeof styleFormatting.size === "number" ? styleFormatting.size : null,
            fontColor: fontValue(styleFormatting.color),
            bold: typeof styleFormatting.bold === "boolean" ? styleFormatting.bold : null,
            italic: typeof styleFormatting.italic === "boolean" ? styleFormatting.italic : null,
            underline:
              typeof styleFormatting.underline === "boolean" ? styleFormatting.underline : null,
          },
          unsupportedProperties: [...paragraphUnsupported],
        };
      });

      const anyContext = context as unknown as { document?: { id?: string } };
      const fullDocumentHash = hashDocument(fullText);
      const hasCollection = items.length > 0;
      if (!hasCollection) unsupported.add("paragraphCollection");

      return {
        id: anyContext.document?.id ?? fullDocumentHash,
        text,
        fullText,
        paragraphs: paragraphsDto,
        capturedAt: new Date().toISOString(),
        fullDocumentHash,
        hash: fullDocumentHash,
        analysisStart: 0,
        analysisEnd: text.length,
        analysisTruncated: fullText.length > maxChars,
        coverage: {
          paragraphCollection: hasCollection ? "partial" : "unsupported",
          directFormattingProvenance: styleItems.length > 0 ? "partial" : "unsupported",
          unsupported: [...unsupported],
        },
      };
    });
  } catch {
    const capturedAt = new Date().toISOString();
    return {
      id: "unavailable",
      text: "",
      fullText: "",
      paragraphs: [],
      capturedAt,
      analysisStart: 0,
      analysisEnd: 0,
      analysisTruncated: false,
      coverage: {
        paragraphCollection: "unsupported",
        directFormattingProvenance: "unsupported",
        unsupported: ["officeRuntime"],
      },
    };
  }
}

function paragraphStyleName(paragraph: ParagraphView): string {
  if (typeof paragraph.style === "string" && paragraph.style.trim().length > 0) {
    return paragraph.style.trim();
  }
  if (
    paragraph.style !== undefined &&
    typeof paragraph.style !== "string" &&
    typeof paragraph.style.name === "string" &&
    paragraph.style.name.trim().length > 0
  ) {
    return paragraph.style.name.trim();
  }
  return "Normal";
}

function readListLevel(
  paragraph: ParagraphView,
  paragraphUnsupported: Set<string>,
  unsupported: Set<string>,
): number | null {
  if (paragraph.isListItem === false) return null;
  const level = paragraph.listItem?.level;
  if (typeof level === "number" && Number.isInteger(level) && level >= 0 && level <= 8) {
    return level;
  }
  const property = "listLevel";
  paragraphUnsupported.add(property);
  unsupported.add(property);
  return null;
}

function deriveProvenance(
  paragraph: ParagraphView,
  style: FontView,
  paragraphUnsupported: Set<string>,
): FormattingPropertyProvenance {
  const properties = [
    "alignment",
    "lineSpacing",
    "spaceAfter",
    "spaceBefore",
    "listLevel",
    "fontName",
    "fontSize",
    "fontColor",
    "bold",
    "italic",
    "underline",
  ] as const;
  return Object.fromEntries(
    properties.map((property) => {
      if (
        property === "fontName" ||
        property === "fontSize" ||
        property === "fontColor" ||
        property === "bold" ||
        property === "italic" ||
        property === "underline"
      ) {
        const effective = readEffective(paragraph, property);
        const inherited = readStyle(style, property);
        if (
          effective === undefined ||
          effective === null ||
          inherited === undefined ||
          inherited === null
        ) {
          return [property, "unknown"];
        }
        return [property, effective === inherited ? "style" : "direct"];
      }
      return [property, paragraphUnsupported.has(property) ? "unsupported" : "direct"];
    }),
  ) as unknown as FormattingPropertyProvenance;
}

function readEffective(
  paragraph: ParagraphView,
  property: "fontName" | "fontSize" | "fontColor" | "bold" | "italic" | "underline",
): unknown {
  if (property === "fontName") return paragraph.font?.name ?? null;
  if (property === "fontSize") return paragraph.font?.size ?? null;
  if (property === "fontColor") return paragraph.font?.color ?? null;
  return paragraph.font?.[property] ?? null;
}

function readStyle(
  style: FontView,
  property: "fontName" | "fontSize" | "fontColor" | "bold" | "italic" | "underline",
): unknown {
  if (property === "fontName") return style.name;
  if (property === "fontSize") return style.size;
  if (property === "fontColor") return style.color;
  return style[property];
}

function fontValue(value: string | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeAlignment(value: unknown): FormattingParagraph["alignment"] {
  if (typeof value !== "string") return null;
  switch (value.toLowerCase()) {
    case "left":
      return "left";
    case "center":
    case "centered":
      return "center";
    case "right":
      return "right";
    case "justified":
      return "justified";
    default:
      return null;
  }
}
