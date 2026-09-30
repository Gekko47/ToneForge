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
import { describeError, logger } from "../shared/utils/logger";
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
  leftIndent?: number;
  rightIndent?: number;
  firstLineIndent?: number;
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
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

/** Properties requested on every host. Text alone is the floor of any scope. */
const BASE_PARAGRAPH_PROPERTIES: readonly string[] = ["text", "uniqueLocalId"];

/** Optional property groups, each bound to one probed capability. */
const CAPABILITY_PROPERTY_GROUPS: readonly {
  capability: keyof AnalysisCapabilities;
  properties: readonly string[];
}[] = [
  { capability: "supportsStyles", properties: ["style", "styleBuiltIn"] },
  { capability: "supportsListLevel", properties: ["isListItem", "listItem"] },
  {
    capability: "supportsParagraphFormat",
    properties: [
      "alignment",
      "lineSpacing",
      "spaceAfter",
      "spaceBefore",
      // Spec §6's `ParagraphStandard`. These four are the whole of what a
      // paragraph standard can be compared against, so without them a body or
      // heading standard could only ever check style name and font — and a
      // rule that reports "matches the profile" would be reporting the
      // narrowest thing it happened to read.
      "leftIndent",
      "rightIndent",
      "firstLineIndent",
      "keepNext",
      "keepLines",
      "pageBreakBefore",
    ],
  },
  { capability: "supportsCharacterFormat", properties: ["font"] },
];

/**
 * Read a paragraph property only when the load plan actually asked for it.
 *
 * This is the fix for the fallback that was not one. `planAcquisitionLoads`
 * drops every optional property in the degraded scope, but the DTO builders
 * still read `listItem.level` afterwards — and on a real Office proxy, reading
 * a property that was never loaded throws `PropertyNotLoaded` rather than
 * returning `undefined`. So a retry that had already thrown away everything but
 * text threw again on the way out, and the scan still failed.
 *
 * Every optional read goes through here, so "was this asked for?" is answered
 * by the same plan that built the request. The `try` is the second line of
 * defence, not the first: a host can accept `load("listItem")` and still refuse
 * to serve it for one particular paragraph, and that must cost one property
 * rather than the whole scan.
 */
function readPlanned<T>(plan: AcquisitionLoadPlan, property: string, read: () => T): T | null {
  if (!plan.paragraphProperties.includes(property)) return null;
  try {
    const value = read();
    return value === undefined ? null : value;
  } catch (error: unknown) {
    logger.warn("Planned paragraph property could not be read", {
      ...describeError(error),
      property,
    });
    return null;
  }
}

export interface AcquisitionLoadPlan {
  /** Whether `document.styles` may be loaded at all. */
  styleCollection: boolean;
  /** Paragraph properties to request, base properties included. */
  paragraphProperties: readonly string[];
  /** Properties deliberately not requested, for honest coverage reporting. */
  skipped: readonly string[];
}

/**
 * Decide what may be asked of this host before asking for it.
 *
 * Loading a property the host does not expose does not degrade quietly: Word
 * rejects the whole request with a generic `GeneralException`, which costs the
 * entire scan rather than the one property. The capability probe already knows
 * which families are missing, so the request is built from the probe result
 * instead of from the shape of the API we wish existed.
 */
export function planAcquisitionLoads(
  capabilities: AnalysisCapabilities,
  degraded = false,
): AcquisitionLoadPlan {
  if (degraded) {
    return {
      styleCollection: false,
      paragraphProperties: BASE_PARAGRAPH_PROPERTIES,
      skipped: ["styles", ...CAPABILITY_PROPERTY_GROUPS.flatMap((group) => [...group.properties])],
    };
  }

  const skipped: string[] = [];
  const optional: string[] = [];
  CAPABILITY_PROPERTY_GROUPS.forEach((group) => {
    if (capabilities[group.capability] === true) {
      optional.push(...group.properties);
      return;
    }
    skipped.push(...group.properties);
  });

  return {
    styleCollection: capabilities.supportsStyles,
    paragraphProperties: [...BASE_PARAGRAPH_PROPERTIES, ...optional],
    skipped: capabilities.supportsStyles ? skipped : ["styles", ...skipped],
  };
}

interface AcquiredScope {
  context: Office.Context;
  fullText: string;
  analysisText: string;
  paragraphItems: ParagraphView[];
  styleItems: StyleView[];
}

/** Run one Word request transaction for a given load plan. */
async function acquireScope(plan: AcquisitionLoadPlan, maxChars: number): Promise<AcquiredScope> {
  return runInWord(async (context) => {
    const body = context.document.body;
    const paragraphs = body.paragraphs;
    const styles = plan.styleCollection ? context.document.styles : undefined;
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
      paragraph.load?.([...plan.paragraphProperties]);
    });
    styleItems.forEach((style) => style.load?.(["name", "nameLocal", "font"]));
    await context.sync();
    return { context, fullText, analysisText, paragraphItems, styleItems };
  });
}

/**
 * Whether this host has already refused the rich scope, and the capability set
 * it was refused under.
 *
 * Without this, a wrong probe costs a full failed Word transaction on *every*
 * scan for the rest of the session. The observer rescans on each document
 * change, so a user typing in a document whose host refuses one property family
 * paid that failed transaction per edit, and each failure emitted a status that
 * re-rendered the whole task pane.
 *
 * The capabilities are remembered alongside the flag so a fresh probe is
 * allowed to re-open the question. `prepareReformatHost` re-probes before every
 * Apply, so a host that gains the family later is picked up on that path rather
 * than being written off for the session.
 */
let refusedCapabilities: AnalysisCapabilities | null = null;

function richScopeRefusedFor(capabilities: AnalysisCapabilities): boolean {
  return refusedCapabilities === capabilities;
}

function rememberRefusal(capabilities: AnalysisCapabilities): void {
  refusedCapabilities = capabilities;
}

/**
 * Reset the remembered refusal.
 *
 * Module state is not a mock, so `vitest.config.ts`'s `clearMocks` and
 * `restoreMocks` do not reach it: without this, one test's refusal would make
 * the next test's acquisition start degraded and the suite would depend on file
 * order.
 */
export function __resetRefusedCapabilities(): void {
  refusedCapabilities = null;
}

/** Acquire the complete analysis scope in one Word request transaction. */
export async function acquireAnalysisContext(
  options: AnalysisAcquisitionOptions,
): Promise<AnalysisContext> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  // A remembered refusal is honoured for the same capability set only. A new
  // probe result is new evidence, so it gets a new attempt at the rich scope.
  let plan = planAcquisitionLoads(options.capabilities, richScopeRefusedFor(options.capabilities));
  let acquired: AcquiredScope;
  try {
    acquired = await acquireScope(plan, maxChars);
  } catch (error: unknown) {
    // The probe can be wrong: a requirement set can be added by the host after
    // the probe ran, and a property family we believed was safe can still be
    // refused. Retrying text-only keeps the deterministic rules running over the
    // whole document instead of losing every scan to one rejected property.
    logger.warn("Analysis acquisition fell back to a text-only scope", {
      ...describeError(error),
      failedProperties: plan.paragraphProperties.join(","),
    });
    rememberRefusal(options.capabilities);
    plan = planAcquisitionLoads(options.capabilities, true);
    acquired = await acquireScope(plan, maxChars);
  }

  // The plan travels with the acquired scope. The builders read properties
  // through it, so a degraded scope is honoured all the way to the DTO rather
  // than only at the point of the request.
  const snapshot = buildSnapshot(acquired, maxChars, plan);
  const formatting = buildFormatting(acquired, maxChars, plan);
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
    // Properties this host would not serve are named here, so a text-only
    // result is never reported as though it were a formatting-aware one.
    unsupported: [
      ...(acquired.paragraphItems.length > 0
        ? ["tables", "headers", "footers", "sections", "fields", "controls", "shapes"]
        : ["wordParagraphCollection"]),
      ...plan.skipped,
    ],
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
  plan: AcquisitionLoadPlan,
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
    const styleName = plannedStyleName(paragraph, plan);
    const styleBuiltIn = readPlanned(plan, "styleBuiltIn", () => paragraph.styleBuiltIn);
    const heading = /^(?:Heading\s*([1-9])|Heading([1-9]))$/i.exec(styleBuiltIn ?? styleName);
    const isListItem = readPlanned(plan, "isListItem", () => paragraph.isListItem);
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
      type: heading ? "heading" : isListItem === true ? "listItem" : "paragraph",
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
  plan: AcquisitionLoadPlan,
): FormattingSnapshot {
  const styleByName = new Map(
    acquired.styleItems.map((style) => [style.nameLocal ?? style.name ?? "", style.font ?? {}]),
  );
  const paragraphs: FormattingParagraph[] = acquired.paragraphItems.map((paragraph, index) => {
    const text = typeof paragraph.text === "string" ? paragraph.text : "";
    const styleName = plannedStyleName(paragraph, plan);
    const styleFont = styleByName.get(styleName) ?? {};
    const nodeId = buildParagraphNodeId({
      ...(paragraph.uniqueLocalId ? { uniqueLocalId: paragraph.uniqueLocalId } : {}),
      index,
      text,
    });
    const font = readPlanned(plan, "font", () => paragraph.font);
    const listLevel = readPlanned(plan, "listItem", () => paragraph.listItem?.level);
    /*
     * A missing list level is only *unsupported* when the plan asked for one and
     * the host would not serve it. In a degraded scope the plan never asked, so
     * reporting `listLevel` as unsupported would blame the host for a scope
     * ToneForge chose.
     */
    const unsupportedProperties: string[] =
      listLevel === null && plan.paragraphProperties.includes("listItem") ? ["listLevel"] : [];
    PLANNED_FLOW_PROPERTIES.forEach((property) => {
      const value = readPlanned(plan, property, () => paragraph[property]);
      if (value === null && plan.paragraphProperties.includes(property)) {
        unsupportedProperties.push(property);
      }
    });
    return {
      index,
      nodeId,
      sourcePath: `body/paragraph/${index}`,
      text,
      styleName,
      alignment: normalizeAlignment(readPlanned(plan, "alignment", () => paragraph.alignment)),
      lineSpacing: readPlanned(plan, "lineSpacing", () => paragraph.lineSpacing),
      spaceAfter: readPlanned(plan, "spaceAfter", () => paragraph.spaceAfter),
      spaceBefore: readPlanned(plan, "spaceBefore", () => paragraph.spaceBefore),
      listLevel: typeof listLevel === "number" ? listLevel : null,
      leftIndent: numberOrNull(readPlanned(plan, "leftIndent", () => paragraph.leftIndent)),
      rightIndent: numberOrNull(readPlanned(plan, "rightIndent", () => paragraph.rightIndent)),
      firstLineIndent: numberOrNull(
        readPlanned(plan, "firstLineIndent", () => paragraph.firstLineIndent),
      ),
      keepNext: booleanOrNull(readPlanned(plan, "keepNext", () => paragraph.keepNext)),
      keepLines: booleanOrNull(readPlanned(plan, "keepLines", () => paragraph.keepLines)),
      pageBreakBefore: booleanOrNull(
        readPlanned(plan, "pageBreakBefore", () => paragraph.pageBreakBefore),
      ),
      fontName: fontValue(font?.name),
      fontSize: font?.size ?? null,
      fontColor: fontValue(font?.color),
      bold: font?.bold ?? null,
      italic: font?.italic ?? null,
      underline: font?.underline ?? null,
      styleFormatting: {
        fontName: fontValue(styleFont.name),
        fontSize: styleFont.size ?? null,
        fontColor: fontValue(styleFont.color),
        bold: styleFont.bold ?? null,
        italic: styleFont.italic ?? null,
        underline: styleFont.underline ?? null,
      },
      provenance: deriveAcquisitionProvenance(plan, paragraph, styleFont),
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
  plan: AcquisitionLoadPlan,
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
        const font = readPlanned(plan, "font", () => paragraph.font);
        const effective =
          property === "fontName"
            ? font?.name
            : property === "fontSize"
              ? font?.size
              : property === "fontColor"
                ? font?.color
                : font?.[property];
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

/**
 * Resolve a paragraph's style name, honouring the load plan.
 *
 * `style` is an optional family: a degraded scope never asked for it, and a
 * scope on a host without style support never asked for it either. Reading it
 * unconditionally is the same defect as the `listItem.level` read — the proxy
 * throws `PropertyNotLoaded` rather than answering `undefined`.
 *
 * "Normal" is the honest answer when the style was not loaded: it is the style
 * Word applies by default, and reporting it as a name ToneForge actually read
 * would be a claim the plan cannot support.
 */
function plannedStyleName(paragraph: ParagraphView, plan: AcquisitionLoadPlan): string {
  const style = readPlanned(plan, "style", () => paragraph.style);
  if (typeof style === "string" && style.trim()) return style.trim();
  if (
    style !== null &&
    typeof style === "object" &&
    typeof (style as { name?: unknown }).name === "string" &&
    (style as { name: string }).name.trim()
  ) {
    return (style as { name: string }).name.trim();
  }
  return "Normal";
}

/**
 * Paragraph indentation and flow properties carried through the DTO.
 *
 * They are grouped because they share one truthiness rule: Word reports
 * `false` and `0` for a real value, so the absence of a value is the only
 * thing that becomes `null`.
 */
const PLANNED_FLOW_PROPERTIES = [
  "leftIndent",
  "rightIndent",
  "firstLineIndent",
  "keepNext",
  "keepLines",
  "pageBreakBefore",
] as const;

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: boolean | null | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function fontValue(value: string | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
