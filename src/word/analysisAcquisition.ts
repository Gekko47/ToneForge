/**
 * Single-pass analysis acquisition.
 *
 * This is the only production analysis acquisition path. It loads complete
 * body identity, Word paragraph items, and formatting properties in one
 * `runInWord` transaction, then returns an immutable host-neutral context.
 */

import { createGovernanceProfile, type GovernanceProfile } from "../core/domain/GovernanceProfile";
import {
  DocumentSnapshotSchema,
  type DocumentNode,
  type DocumentSnapshot,
  buildNodeId,
  buildParagraphNodeId,
} from "../core/domain/DocumentSnapshot";
import type { StyleProfile } from "../core/domain/StyleProfile";
import { hashText } from "../shared/utils/text";
import { runInWord } from "../shared/office/officeHelpers";
import { hashDocument } from "./documentReader";
import { normalizeAlignment } from "./formattingReader";
import {
  createAnalysisContext,
  type AcquisitionDiagnostics,
  type AnalysisCapabilities,
  type AnalysisContext,
} from "../analysis/analysisContext";
import type { FormattingParagraph, FormattingSnapshot } from "../formatting/formattingSnapshot";

export interface AnalysisAcquisitionOptions {
  profile: StyleProfile;
  capabilities: AnalysisCapabilities;
  policy?: GovernanceProfile;
  maxChars?: number;
}

interface ParagraphView {
  text?: string;
  style?: string | { name?: string };
  styleBuiltIn?: string;
  uniqueLocalId?: string;
  isListItem?: boolean;
  alignment?: string;
  lineSpacing?: number;
  spaceAfter?: number;
  spaceBefore?: number;
  font?: FontView;
  listItem?: { level?: number };
  load?: (properties: string | string[]) => unknown;
}

interface FontView {
  name?: string;
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

interface StyleView {
  name?: string;
  nameLocal?: string;
  font?: FontView;
  load?: (properties: string | string[]) => unknown;
}

const DEFAULT_MAX_CHARS = 500_000;

/** Acquire the complete analysis scope in one Word request transaction. */
export async function acquireAnalysisContext(
  options: AnalysisAcquisitionOptions,
): Promise<AnalysisContext> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const acquired = await runInWord(async (context) => {
    const body = context.document.body;
    const paragraphs = body.paragraphs;
    const styles = context.document.styles;
    body.load("text");
    paragraphs?.load("items");
    styles?.load("items");
    await context.sync();

    const fullText = body.text ?? "";
    const analysisText = fullText.slice(0, maxChars);
    const paragraphItems = Array.isArray(paragraphs?.items)
      ? (paragraphs.items as ParagraphView[])
      : [];
    const styleItems = Array.isArray(styles?.items) ? (styles.items as StyleView[]) : [];
    paragraphItems.forEach((paragraph) => {
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
    return { context, fullText, analysisText, paragraphItems, styleItems };
  });

  const snapshot = buildSnapshot(acquired, maxChars);
  const formatting = buildFormatting(acquired, maxChars);
  const policy = options.policy ?? createGovernanceProfile(options.profile);
  const governedNodes = snapshot.nodes.map((node) => {
    const reason = node.protectionReason;
    const protectedByPolicy =
      (reason === "quote" || reason === "quoted-text") && policy.protection.protectQuotedText;
    const captionProtected = reason === "caption" && policy.protection.protectCaptions;
    const commentProtected = reason === "comment" && policy.protection.protectComments;
    const lockedProtected = policy.protection.userLockedRanges.includes(node.nodeId);
    if (!protectedByPolicy && !captionProtected && !commentProtected && !lockedProtected)
      return node;
    return {
      ...node,
      editable: false,
      includedInGovernance: false,
      includedInAIReview: false,
      protectionReason: reason ?? (lockedProtected ? "user-locked" : "governance-protected"),
    };
  });
  const acquisition: AcquisitionDiagnostics = {
    runId: `${snapshot.documentId}:${snapshot.contentHash}`,
    acquisitionReadCount: 1,
    syncCount: 2,
    analyzedCharacterCount: acquired.analysisText.length,
    completeDocumentCharacterCount: acquired.fullText.length,
    fullBodyReadCount: 1,
    paragraphCollectionRead: acquired.paragraphItems.length > 0,
    structuralCoverage: acquired.paragraphItems.length > 0 ? "partial" : "unsupported",
    unsupported:
      acquired.paragraphItems.length > 0
        ? ["tables", "headers", "footers", "sections", "fields", "controls", "shapes"]
        : ["wordParagraphCollection"],
    incremental: false,
    incrementalReason:
      "No verified Word changed-range event; conservative full rescan is supported.",
  };
  return createAnalysisContext({
    snapshot: { ...snapshot, nodes: governedNodes },
    formatting,
    profile: options.profile,
    policy,
    capabilities: options.capabilities,
    acquisition,
  });
}

function buildSnapshot(
  acquired: {
    context: Office.Context;
    fullText: string;
    analysisText: string;
    paragraphItems: ParagraphView[];
  },
  maxChars: number,
): DocumentSnapshot {
  const nodes: DocumentNode[] = [
    {
      nodeId: buildNodeId("body", "body"),
      type: "body",
      sourcePath: "body",
      editable: true,
      includedInGovernance: true,
      includedInAIReview: true,
    },
  ];
  let offset = 0;
  let bodyCursor = 0;
  acquired.paragraphItems.forEach((paragraph, index) => {
    const text = typeof paragraph.text === "string" ? paragraph.text : "";
    const styleName = paragraphStyleName(paragraph);
    const heading = /^(?:Heading\s*([1-9])|Heading([1-9]))$/i.exec(
      paragraph.styleBuiltIn ?? styleName,
    );
    const nodeId = buildParagraphNodeId({
      ...(paragraph.uniqueLocalId ? { uniqueLocalId: paragraph.uniqueLocalId } : {}),
      index,
      text,
    });
    const sourcePath = `body/paragraph/${index}`;
    const isQuoted = /"(?:[^"\\]|\\.)*"/.test(text);
    const isCaption = /^(?:caption|figure|table)\b/i.test(styleName);
    const locatedStart = acquired.fullText.indexOf(text, bodyCursor);
    const startOffset = locatedStart >= 0 ? locatedStart : offset;
    const endOffset = startOffset + text.length;
    bodyCursor = endOffset;
    nodes.push({
      nodeId,
      type: heading ? "heading" : paragraph.isListItem ? "listItem" : "paragraph",
      text,
      sourcePath,
      sourceRange: {
        nodeId,
        paragraphIndex: index,
        startOffset,
        endOffset,
        structuralPath: sourcePath,
      },
      editable: !isQuoted && !isCaption,
      includedInGovernance: !isQuoted && !isCaption,
      includedInAIReview: !isQuoted && !isCaption,
      ...(isQuoted || isCaption ? { protectionReason: isQuoted ? "quoted-text" : "caption" } : {}),
    });
    offset = endOffset;
  });
  const contentHash = hashDocument(acquired.fullText);
  const structuralHash = hashText(
    nodes.map((node) => `${node.nodeId}:${node.type}:${node.sourcePath}`).join("|"),
  );
  const anyContext = acquired.context as unknown as { document?: { id?: string } };
  const capturedAt = new Date().toISOString();
  return DocumentSnapshotSchema.parse({
    documentId: anyContext.document?.id ?? contentHash,
    versionToken: `${capturedAt}:${contentHash}`,
    contentHash,
    structuralHash,
    capturedAt,
    fullText: acquired.fullText,
    analysisText: acquired.analysisText,
    analysisStart: 0,
    analysisEnd: acquired.analysisText.length,
    analysisTruncated: acquired.fullText.length > maxChars,
    acquisition: {
      paragraphsFromWordCollection: acquired.paragraphItems.length > 0,
      structuralCoverage: acquired.paragraphItems.length > 0 ? "partial" : "unsupported",
      unsupported:
        acquired.paragraphItems.length > 0
          ? ["tables", "headers", "footers", "sections", "fields", "controls", "shapes"]
          : ["wordParagraphCollection"],
    },
    nodes,
  });
}

function buildFormatting(
  acquired: {
    context: Office.Context;
    fullText: string;
    analysisText: string;
    paragraphItems: ParagraphView[];
    styleItems: StyleView[];
  },
  maxChars: number,
): FormattingSnapshot {
  const styleByName = new Map(
    acquired.styleItems.map((style) => [style.nameLocal ?? style.name ?? "", style.font ?? {}]),
  );
  const paragraphs: FormattingParagraph[] = acquired.paragraphItems.map((paragraph, index) => {
    const text = typeof paragraph.text === "string" ? paragraph.text : "";
    const styleName = paragraphStyleName(paragraph);
    const styleFont = styleByName.get(styleName) ?? {};
    const nodeId = buildParagraphNodeId({
      ...(paragraph.uniqueLocalId ? { uniqueLocalId: paragraph.uniqueLocalId } : {}),
      index,
      text,
    });
    const unsupportedProperties: string[] = [];
    const listLevel =
      typeof paragraph.listItem?.level === "number" ? paragraph.listItem.level : null;
    if (paragraph.isListItem !== false && listLevel === null)
      unsupportedProperties.push("listLevel");
    return {
      index,
      nodeId,
      sourcePath: `body/paragraph/${index}`,
      text,
      styleName,
      alignment: normalizeAlignment(paragraph.alignment),
      lineSpacing: paragraph.lineSpacing ?? null,
      spaceAfter: paragraph.spaceAfter ?? null,
      spaceBefore: paragraph.spaceBefore ?? null,
      listLevel,
      fontName: fontValue(paragraph.font?.name),
      fontSize: paragraph.font?.size ?? null,
      fontColor: fontValue(paragraph.font?.color),
      bold: paragraph.font?.bold ?? null,
      italic: paragraph.font?.italic ?? null,
      underline: paragraph.font?.underline ?? null,
      styleFormatting: {
        fontName: fontValue(styleFont.name),
        fontSize: styleFont.size ?? null,
        fontColor: fontValue(styleFont.color),
        bold: styleFont.bold ?? null,
        italic: styleFont.italic ?? null,
        underline: styleFont.underline ?? null,
      },
      provenance: deriveAcquisitionProvenance(paragraph, styleFont),
      unsupportedProperties,
    };
  });
  const unsupported = new Set<string>();
  if (acquired.paragraphItems.length === 0) unsupported.add("paragraphCollection");
  paragraphs.forEach((paragraph) => {
    paragraph.unsupportedProperties?.forEach((property) => unsupported.add(property));
  });
  const fullDocumentHash = hashDocument(acquired.fullText);
  const anyContext = acquired.context as unknown as { document?: { id?: string } };
  return {
    id: anyContext.document?.id ?? fullDocumentHash,
    text: acquired.analysisText,
    fullText: acquired.fullText,
    paragraphs,
    capturedAt: new Date().toISOString(),
    fullDocumentHash,
    hash: fullDocumentHash,
    analysisStart: 0,
    analysisEnd: acquired.analysisText.length,
    analysisTruncated: acquired.fullText.length > maxChars,
    coverage: {
      paragraphCollection: acquired.paragraphItems.length > 0 ? "partial" : "unsupported",
      directFormattingProvenance: acquired.styleItems.length > 0 ? "partial" : "unsupported",
      unsupported: [...unsupported],
    },
  };
}

function deriveAcquisitionProvenance(
  paragraph: ParagraphView,
  style: FontView,
): FormattingParagraph["provenance"] {
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
        const effective =
          property === "fontName"
            ? paragraph.font?.name
            : property === "fontSize"
              ? paragraph.font?.size
              : property === "fontColor"
                ? paragraph.font?.color
                : paragraph.font?.[property];
        const inherited =
          property === "fontName"
            ? style.name
            : property === "fontSize"
              ? style.size
              : property === "fontColor"
                ? style.color
                : style[property];
        if (
          effective === undefined ||
          effective === null ||
          inherited === undefined ||
          inherited === null
        )
          return [property, "unknown"];
        return [property, effective === inherited ? "style" : "direct"];
      }
      return [property, "unknown"];
    }),
  ) as FormattingParagraph["provenance"];
}

function paragraphStyleName(paragraph: ParagraphView): string {
  if (typeof paragraph.style === "string" && paragraph.style.trim()) return paragraph.style.trim();
  if (
    paragraph.style !== undefined &&
    typeof paragraph.style !== "string" &&
    typeof paragraph.style.name === "string" &&
    paragraph.style.name.trim()
  ) {
    return paragraph.style.name.trim();
  }
  return "Normal";
}

function fontValue(value: string | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
