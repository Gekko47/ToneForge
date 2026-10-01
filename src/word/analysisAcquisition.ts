/**
 * Single-pass analysis acquisition.
 *
 * This is the only production analysis acquisition path. It loads complete
 * body identity, Word paragraph items, and formatting properties in one
 * `runInWord` transaction, then returns an immutable host-neutral context.
 */

import {
  createGovernanceProfile,
  type GovernanceProfile,
  type ScopePolicy,
} from "../core/domain/GovernanceProfile";
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
import type {
  FormattingParagraph,
  FormattingSnapshot,
  HeaderFooterSnapshot,
  SectionSnapshot,
  TableSnapshot,
} from "../formatting/formattingSnapshot";

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

/**
 * A `Word.Table`, as this module is allowed to read one. Spec §8.3.
 *
 * Every name below was read off `Word.Interfaces.TableLoadOptions` rather than
 * assumed — <https://learn.microsoft.com/javascript/api/word/word.interfaces.tableloadoptions>
 * — because a name the host does not have refuses the whole transaction, not
 * the one property. See `LOADABLE_PARAGRAPH_PROPERTIES` for the same argument
 * applied to paragraphs.
 *
 * Note what is absent: `Word.Table` has no cell style name on that list.
 * `TableSnapshot.cellStyleName` therefore stays `null` — "not read" — and the
 * analyzer skips that comparison, rather than a table being reported compliant
 * on evidence nobody collected.
 */
interface TableView {
  style?: string | undefined;
  styleBuiltIn?: string | undefined;
  values?: string[][] | undefined;
  rowCount?: number | undefined;
  headerRowCount?: number | undefined;
}

/**
 * The table properties this module is allowed to request. Spec §8.3.
 *
 * Typed as a tuple so `LOADABLE_TABLE_PROPERTIES` cannot hold a name
 * `Word.Table` does not have, for the reason `LOADABLE_PARAGRAPH_PROPERTIES`
 * exists: the host refuses the whole request rather than the one bad name.
 */
export const LOADABLE_TABLE_PROPERTIES = [
  "style",
  "styleBuiltIn",
  "values",
  "rowCount",
  "headerRowCount",
] as const;

/**
 * A `Word.PageSetup`. Spec §8.5.
 *
 * **WordApiDesktop 1.3, so it is absent on Word on the web** —
 * <https://learn.microsoft.com/javascript/api/word/word.interfaces.pagesetuploadoptions>.
 * `Section` and `SectionCollection` are 1.1; only this nested object is
 * desktop-only. That difference is why it is read in its own guarded
 * transaction rather than folded into the shared section load: a name the host
 * does not have costs the entire request, which is how a scan silently loses
 * every scope it had already collected.
 */
interface PageSetupView {
  orientation?: string | undefined;
  topMargin?: number | undefined;
  bottomMargin?: number | undefined;
  leftMargin?: number | undefined;
  rightMargin?: number | undefined;
  pageWidth?: number | undefined;
  pageHeight?: number | undefined;
}

/**
 * The page-setup properties §8.5 is allowed to compare.
 *
 * Orientation, the four margins, and the two page dimensions — which is exactly
 * what `SectionSnapshot` carries and exactly what `checkPageSetup` checks.
 * Nothing here is inferred from anything else, because a margin derived from
 * page size and gutter would be a number no author ever asked for.
 */
export const PAGE_SETUP_PROPERTIES = [
  "orientation",
  "topMargin",
  "bottomMargin",
  "leftMargin",
  "rightMargin",
  "pageWidth",
  "pageHeight",
] as const;

/** A header or footer body, reached through `Section.getHeader`/`getFooter`. */
interface HeaderFooterView {
  kind: "header" | "footer";
  slot: Office.HeaderFooterType;
  text?: string | undefined;
  styleName?: string | undefined;
  font?: FontView | undefined;
}

/** The live body Office returned for one header/footer slot, before the read. */
interface PendingHeaderFooter {
  kind: "header" | "footer";
  slot: Office.HeaderFooterType;
  body: Office.Body | undefined;
}

/** A `Word.Section` with the text it can serve on any WordApi 1.1 host. */
interface SectionView {
  text: string;
  headerFooters: HeaderFooterView[];
}

/**
 * The three header/footer slots a section has, and the reason all three are
 * read rather than just the primary one.
 *
 * `required` in the profile is a claim about whether a header is *present*, and
 * Word will only tell you that by serving an empty one: a section with no
 * footer still has a primary footer body, it is simply blank. Reading only
 * `Primary` would leave the first-page and even-page slots permanently
 * unreported, which is the same false-compliance claim as reading none of them.
 */
const HEADER_FOOTER_SLOTS: readonly Office.HeaderFooterType[] = [
  "Primary",
  "FirstPage",
  "EvenPages",
];

const DEFAULT_MAX_CHARS = 500_000;

/**
 * Every paragraph property name this module is allowed to request.
 *
 * **Authority**: Microsoft's `Word.Paragraph` reference, which lists the members
 * a paragraph can load — <https://learn.microsoft.com/javascript/api/word/word.paragraph>.
 * `keepNext`, `keepLines` and `pageBreakBefore` are *not* on it, and neither is
 * `paragraphFormat`: `Word.ParagraphFormat` is reached through
 * `Word.Style.paragraphFormat` and `Word.ConditionalStyle.paragraphFormat`, not
 * through a paragraph. Check that page before adding a name here.
 *
 * **Why a declared list rather than free strings.** A name the host does not
 * have is not a partial read: Word rejects the whole `load` with a generic
 * `GeneralException`, taking every other property in the same request with it.
 * That is the failure this file builds its request from the probe result to
 * avoid, so a typo must not be able to reintroduce it. Typed as a tuple so the
 * element type below is a union — `CAPABILITY_PROPERTY_GROUPS` cannot hold a
 * name outside it, and neither can `readPlanned`. Both accepted any `string`
 * before, which is how `paragraphFormat` compiled and shipped in 21ce84d.
 *
 * This is a compile-time gate, not a runtime one. It cannot tell you a name is
 * *wrong*, only that it is not on this list — so adding a plausible-sounding
 * entry here still requires reading the reference above. The independent check
 * that catches that is in `analysisAcquisitionDegradedScope.test.ts`, where the
 * host double carries its own copy of the property list.
 */
export const LOADABLE_PARAGRAPH_PROPERTIES = [
  "text",
  "uniqueLocalId",
  "style",
  "styleBuiltIn",
  "isListItem",
  "listItem",
  "alignment",
  "lineSpacing",
  "spaceAfter",
  "spaceBefore",
  // Spec §6's `ParagraphStandard`. These three are what a paragraph standard
  // can be compared against beyond style name and font, so without them a body
  // or heading standard could only ever check the narrowest thing it read.
  "leftIndent",
  "rightIndent",
  "firstLineIndent",
  "font",
] as const;

/** One property name a `Word.Paragraph` can serve. */
export type ParagraphProperty = (typeof LOADABLE_PARAGRAPH_PROPERTIES)[number];

/** Properties requested on every host. Text alone is the floor of any scope. */
const BASE_PARAGRAPH_PROPERTIES: readonly ParagraphProperty[] = ["text", "uniqueLocalId"];

/** Optional property groups, each bound to one probed capability. */
const CAPABILITY_PROPERTY_GROUPS: readonly {
  capability: keyof AnalysisCapabilities;
  properties: readonly ParagraphProperty[];
}[] = [
  { capability: "supportsStyles", properties: ["style", "styleBuiltIn"] },
  { capability: "supportsListLevel", properties: ["isListItem", "listItem"] },
  {
    capability: "supportsParagraphFormat",
    /*
     * No flow controls, and so no `paragraphFormat` to reach them through.
     *
     * `keepWithNext` and `keepTogether` are properties of `Word.ParagraphFormat`,
     * which a paragraph cannot reach — see the reference named above. Asking for
     * a name the API lacks costs this whole group, not the one name: the request
     * is rejected and `alignment`, the indents and the spacing go with it, which
     * is how a scan silently loses its formatting coverage while still looking
     * clean.
     *
     * The fields stay `null` in the DTO, the answer "not read", and the analyzer
     * skips a comparison it has no evidence for. They remain editable in the
     * profile until an API that can serve them exists; see ADR-0084.
     */
    properties: [
      "alignment",
      "lineSpacing",
      "spaceAfter",
      "spaceBefore",
      "leftIndent",
      "rightIndent",
      "firstLineIndent",
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
 *
 * `property` is a `ParagraphProperty`, not a `string`, for the same reason the
 * load groups are: a read of a name outside the declared list is a name no
 * paragraph has, and it would otherwise compile.
 */
function readPlanned<T>(
  plan: AcquisitionLoadPlan,
  property: ParagraphProperty,
  read: () => T,
): T | null {
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
  /** Whether `body.tables` may be loaded. Spec §8.3. */
  tableCollection: boolean;
  /** Whether `document.sections` may be loaded. Spec §8.5. */
  sectionCollection: boolean;
  /**
   * Whether `Section.getHeader`/`getFooter` may be called. Spec §8.4.
   *
   * Bound to the section collection as well as to its own capability: a header
   * is only reachable through a section, so the two cannot be gated apart.
   */
  headerFooterCollection: boolean;
  /** Paragraph properties to request, base properties included. */
  paragraphProperties: readonly ParagraphProperty[];
  /** Properties deliberately not requested, for honest coverage reporting. */
  skipped: readonly string[];
  /**
   * Scopes the plan did not ask for, and why.
   *
   * Separate from `skipped` because the remedy differs: `skipped` names something
   * the *host* would not serve, and this names something the *policy* or this pass
   * chose not to read. `coverage.ts` maps the first to `unsupportedByHost` and
   * sends the reader to a different Word; mapping the second the same way blames a
   * host for a decision ToneForge made.
   */
  notAttempted: readonly string[];
}

/**
 * The structural scopes, each with the capability that must be `true` before
 * this module may ask for it, and the token acquisition reports when it cannot.
 *
 * The tokens are the vocabulary `analysis/deterministic/coverage.ts` matches
 * against, so they are declared here once rather than spelled at each use — a
 * token that drifts between the two modules is how a scope reports as examined
 * while the host was in fact unable to serve it.
 */
const STRUCTURAL_SCOPES: readonly {
  capability: keyof AnalysisCapabilities;
  plan: "tableCollection" | "sectionCollection" | "headerFooterCollection";
  token: string;
  /** Whether the scope is off unless this policy flag is on. */
  policyFlag?: keyof ScopePolicy;
  /** Whether the capability above only counts when sections are also readable. */
  requiresSections?: boolean;
}[] = [
  {
    capability: "supportsTables",
    plan: "tableCollection",
    token: "tables",
    policyFlag: "includeTables",
  },
  {
    capability: "supportsSections",
    plan: "sectionCollection",
    token: "sections",
    policyFlag: "includeSections",
  },
  {
    capability: "supportsHeadersFooters",
    plan: "headerFooterCollection",
    token: "headers",
    policyFlag: "includeHeadersFooters",
    requiresSections: true,
  },
  /*
   * The same collection, reported under a second token because the remedy is
   * different: a missing header is a host limitation, while a missing footer is
   * the same fact the reader already has from the header line, and two blocker
   * sentences for one collection would be noise.
   *
   * It therefore carries the *same* `policyFlag` and the *same* `requiresSections`
   * as the entry above, and that is the fix for a real defect. Without them this
   * entry had neither, so it re-enabled the collection on a host whose sections
   * were unreadable, and on a policy that had switched headers and footers off —
   * two scans that read a scope the author had excluded, while the plan reported
   * the collection as served.
   */
  {
    capability: "supportsHeadersFooters",
    plan: "headerFooterCollection",
    token: "footers",
    policyFlag: "includeHeadersFooters",
    requiresSections: true,
  },
];

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
  scope?: ScopePolicy,
): AcquisitionLoadPlan {
  /*
   * The scope policy decides whether a scope is *wanted*; the capability decides
   * whether the host can *serve* it. Both are recorded, and only the second is
   * a host limitation — `coverage.ts` needs to tell the reader which of the two
   * happened, because the remedy is a setting in one case and a different Word
   * in the other. Conflating them sends the reader somewhere that will not help.
   *
   * An absent `scope` means every structural scope is wanted, which is what a
   * caller with no policy to consult means. That is deliberately not the same as
   * "on by default": `ScopePolicySchema` owns the defaults, and this module
   * should not hold a second copy of them that can drift.
   */
  const wanted = (flag: keyof ScopePolicy): boolean => scope === undefined || scope[flag] === true;

  const structural = {
    tableCollection: false,
    sectionCollection: false,
    headerFooterCollection: false,
  };
  const structuralSkipped: string[] = [];
  const notAttempted: string[] = [];
  /*
   * Order is load-bearing, and `STRUCTURAL_SCOPES` is declared in it.
   *
   * A header is reachable only through a section, so the `sections` entry has to
   * decide `sectionCollection` before the `headers` and `footers` entries read
   * it. Reordering the array would let a plan claim the header collection while
   * planning no sections at all, and acquisition would then request header bodies
   * against an empty section list and report the scope as served.
   */
  STRUCTURAL_SCOPES.forEach((entry) => {
    const capabilityPresent =
      capabilities[entry.capability] === true &&
      (!entry.requiresSections || capabilities.supportsSections === true);
    if (capabilityPresent) {
      if (entry.policyFlag !== undefined && !wanted(entry.policyFlag)) {
        // Not attempted by choice, so recorded apart from a host limitation:
        // `coverage.ts` gives these two different remedies.
        notAttempted.push(entry.token);
        return;
      }
      /*
       * A host that *can* read sections, under a policy that switched them off,
       * is not a host limitation either — the scope went unattempted because
       * this plan did not ask for the collection it depends on. Recording it as
       * served would report a scope as examined that nothing read.
       */
      if (entry.requiresSections === true && !structural.sectionCollection) {
        notAttempted.push(entry.token);
        return;
      }
      structural[entry.plan] = true;
      return;
    }
    structuralSkipped.push(entry.token);
  });

  if (degraded) {
    return {
      styleCollection: false,
      tableCollection: false,
      sectionCollection: false,
      headerFooterCollection: false,
      paragraphProperties: BASE_PARAGRAPH_PROPERTIES,
      skipped: [
        "styles",
        ...CAPABILITY_PROPERTY_GROUPS.flatMap((group) => [...group.properties]),
        ...STRUCTURAL_SCOPES.map((entry) => entry.token),
      ],
      // A degraded retry reads nothing at all, so every structural scope went
      // unattempted for the same reason: the request failed, not the policy.
      notAttempted: [...NEVER_ACQUIRED_SCOPES],
    };
  }

  const skipped: string[] = [...structuralSkipped];
  const optional: ParagraphProperty[] = [];
  CAPABILITY_PROPERTY_GROUPS.forEach((group) => {
    if (capabilities[group.capability] === true) {
      optional.push(...group.properties);
      return;
    }
    skipped.push(...group.properties);
  });

  return {
    styleCollection: capabilities.supportsStyles,
    ...structural,
    paragraphProperties: [...BASE_PARAGRAPH_PROPERTIES, ...optional],
    skipped: capabilities.supportsStyles ? skipped : ["styles", ...skipped],
    // `NEVER_ACQUIRED_SCOPES` belongs here, not in `skipped`: no host was asked
    // for them, so `coverage.ts` must not report them as a Word limitation.
    notAttempted: [...notAttempted, ...NEVER_ACQUIRED_SCOPES],
  };
}

interface AcquiredScope {
  context: Office.Context;
  fullText: string;
  analysisText: string;
  paragraphItems: ParagraphView[];
  styleItems: StyleView[];
  /** Spec §8.3. `null` when the plan did not ask, not "there are none". */
  tableItems: TableView[] | null;
  /** Spec §8.4 and §8.5, as one read: headers are reachable only via sections. */
  sectionItems: SectionView[] | null;
  /**
   * Spec §8.5. `null` when this host has no `PageSetup` at all, which is Word on
   * the web; an entry of `null` is one section whose page setup did not load.
   */
  pageSetupItems: Array<PageSetupView | null> | null;
  /** How many `context.sync()` calls the acquisition actually spent. */
  syncCount: number;
  /**
   * Spec §8.5. `true` when the sections were read but the host refused the page
   * setup, so the geometry checks could not run.
   *
   * A signal rather than an inference from `pageSetupItems === null`, because
   * `null` also means "the plan did not ask for sections" — and reporting a web
   * host's refusal as a missing section collection would blame the host for a
   * scope ToneForge chose not to read.
   */
  pageSetupRefused: boolean;
}

/**
 * The scopes acquisition never attempts, whatever the capabilities say.
 *
 * Spec §8.6 requires fields, content controls, shapes and text boxes to be
 * *explicitly* excluded rather than silently unexamined. They belong in the
 * `unsupported` list for every scan, and unlike `tables` or `sections` no probe
 * can turn them on: this pass reads paragraphs, tables, sections and
 * headers/footers, and nothing else. They are named here so the list reads as a
 * decision rather than as an omission, and so adding a reader for one means
 * removing it from this list in the same commit.
 */
const NEVER_ACQUIRED_SCOPES: readonly string[] = [
  "fields",
  "controls",
  "contentControls",
  "shapes",
  "smartArt",
  "images",
  "textBoxes",
  "comments",
  "footnotes",
  "endnotes",
];

/**
 * Read a property this transaction did not plan to ask for, safely.
 *
 * `readPlanned` answers the same question for paragraphs and is typed to the
 * declared property list, because a paragraph read of an unloaded name throws.
 * The structural objects are read straight after their own `load` in the same
 * transaction, so the throw risk is the same and the guard is the same one: a
 * property the plan did not request reads as `null`, never as a value nobody
 * loaded.
 */
function readStructural<T>(planned: boolean, read: () => T): T | null {
  if (!planned) return null;
  try {
    const value = read();
    return value === undefined ? null : value;
  } catch (error: unknown) {
    logger.warn("Planned structural property could not be read", {
      ...describeError(error),
    });
    return null;
  }
}

/**
 * The loaded header/footer font values, as a plain object.
 *
 * `Body.font` is a live Office proxy and stays one after the transaction ends:
 * reading `.name` off it later throws `PropertyNotLoaded` on a real host rather
 * than returning the value, and a DTO holding one is not the host-neutral object
 * this module promises. Each property is therefore read here, inside the
 * transaction that loaded it, and only the three `HEADER_FOOTER_PROPERTIES` names
 * the transaction asked for are carried out.
 *
 * `undefined` means there was no font to read, which is a different answer from a
 * font whose name is `null` — the analyzer skips the former and reports the
 * latter.
 */
function readHeaderFooterFont(body: Office.Body | undefined): FontView | undefined {
  // `?? null` because `readStructural` is typed `T | null` over a `T` that is
  // itself optional: an unread property and a read-but-absent one are both `null`.
  const name = readStructural(true, () => body?.font?.name) ?? null;
  const size = readStructural(true, () => body?.font?.size) ?? null;
  const color = readStructural(true, () => body?.font?.color) ?? null;
  if (name === null && size === null && color === null) return undefined;
  const font: FontView = {};
  if (name !== null) font.name = name;
  if (size !== null) font.size = size;
  if (color !== null) font.color = color;
  return font;
}

/**
 * The header/footer body properties spec §8.4 compares.
 *
 * Text, the body style name, and three font properties. A header is a `Body`, so
 * it has the same surface a body paragraph does and the same limits: there is no
 * `paragraphFormat` to reach flow controls through, and `bold`/`italic`/
 * `underline` are the author's emphasis rather than a house convention, so they
 * are read for evidence but never reported (see `checkHeaderFooterFormatting`,
 * which reports only what the profile names).
 */
const HEADER_FOOTER_PROPERTIES = [
  "text",
  "style",
  "styleBuiltIn",
  "font/name",
  "font/size",
  "font/color",
] as const;

/** Run one Word request transaction for a given load plan. */
async function acquireScope(
  plan: AcquisitionLoadPlan,
  maxChars: number,
  capabilities: AnalysisCapabilities,
): Promise<AcquiredScope> {
  const scope = await runInWord(async (context) => {
    const body = context.document.body;
    const paragraphs = body.paragraphs;
    const styles = plan.styleCollection ? context.document.styles : undefined;
    const tables = plan.tableCollection ? body.tables : undefined;
    const sections = plan.sectionCollection ? context.document.sections : undefined;
    body.load("text");
    paragraphs?.load("items");
    styles?.load("items");
    tables?.load("items");
    sections?.load("items");
    await context.sync();

    const fullText = body.text ?? "";
    const analysisText = fullText.slice(0, maxChars);
    const paragraphItems = Array.isArray(paragraphs?.items)
      ? (paragraphs.items as ParagraphView[])
      : [];
    const styleItems = Array.isArray(styles?.items) ? (styles.items as StyleView[]) : [];
    const tableItems = Array.isArray(tables?.items) ? (tables.items as Office.Table[]) : [];
    const sectionItems = Array.isArray(sections?.items) ? (sections.items as Office.Section[]) : [];
    let syncCount = 1;

    paragraphItems.forEach((paragraph) => {
      paragraph.load?.([...plan.paragraphProperties]);
    });
    styleItems.forEach((style) => style.load?.(["name", "nameLocal", "font"]));
    tableItems.forEach((table) => table.load?.([...LOADABLE_TABLE_PROPERTIES]));
    // Only the 1.1 members. `pageSetup` is deliberately absent from this list;
    // see `acquirePageSetup` for why it costs a transaction of its own.
    sectionItems.forEach((section) => section.load?.(["body/text"]));
    await context.sync();

    /*
     * A header or footer is a `Body` returned by a method call, not a collection
     * member, so it can only be requested after the sections are loaded. The
     * bodies are requested for *all three* slots: Word serves a blank primary
     * header for a section that has none, and that blank is the only evidence
     * that tells `required` apart from "not looked at".
     */
    const pendingHeaderFooters: PendingHeaderFooter[] = [];
    if (plan.headerFooterCollection) {
      sectionItems.forEach((section) => {
        /*
         * Kind outer, slot inner.
         *
         * The order is what the DTO presents, and it is the one a reader of a
         * `headersFooters` list expects: every header for a section, then every
         * footer. Iterating the slots outermost interleaves them — header,
         * footer, header — which is a real ordering in the request and a
         * confusing one in the report.
         */
        (["header", "footer"] as const).forEach((kind) => {
          HEADER_FOOTER_SLOTS.forEach((slot) => {
            const body = kind === "header" ? section.getHeader(slot) : section.getFooter(slot);
            body?.load?.([...HEADER_FOOTER_PROPERTIES]);
            pendingHeaderFooters.push({ kind, slot, body });
          });
        });
      });
      await context.sync();
      syncCount += 1;
    }

    const slotsPerSection = HEADER_FOOTER_SLOTS.length * 2;
    const sectionViews: SectionView[] | null = plan.sectionCollection
      ? sectionItems.map((section, index) => ({
          text: typeof section.body?.text === "string" ? section.body.text : "",
          headerFooters: pendingHeaderFooters
            .slice(index * slotsPerSection, (index + 1) * slotsPerSection)
            .map((view) => ({
              kind: view.kind,
              slot: view.slot,
              text: readStructural(true, () => view.body?.text) ?? undefined,
              styleName:
                readStructural(true, () => view.body?.style) ??
                readStructural(true, () => view.body?.styleBuiltIn) ??
                undefined,
              font: readHeaderFooterFont(view.body),
            })),
        }))
      : null;

    return {
      context,
      fullText,
      analysisText,
      paragraphItems,
      styleItems,
      syncCount,
      tableItems: plan.tableCollection
        ? tableItems.map((table) => ({
            style: readStructural(true, () => table.style) ?? undefined,
            styleBuiltIn: readStructural(true, () => table.styleBuiltIn) ?? undefined,
            values: readStructural(true, () => table.values) ?? undefined,
            rowCount: readStructural(true, () => table.rowCount) ?? undefined,
            headerRowCount: readStructural(true, () => table.headerRowCount) ?? undefined,
          }))
        : null,
      sectionItems: sectionViews,
    };
  });

  /*
   * Page setup, in its own transaction, and only if the sections came back.
   *
   * `Section.pageSetup` is WordApiDesktop 1.3 and `Section` itself is 1.1, so a
   * host can serve the section list and refuse the page setup — that is Word on
   * the web, exactly. Naming `pageSetup` in the shared load above would get the
   * *whole* request refused there, taking the body text, the paragraphs and the
   * styles with it: a document on the web would report as a text-only scan
   * because one nested desktop-only object was named.
   *
   * So it is asked for separately, and a refusal costs this one read. It is
   * remembered per capability set for the same reason the rich-scope refusal is:
   * the observer rescans on every keystroke, and a web host would otherwise pay
   * a failed transaction per edit.
   */
  if (scope.sectionItems === null)
    return { ...scope, pageSetupItems: null, pageSetupRefused: false };

  const pageSetupItems = await acquirePageSetup(capabilities);
  return {
    ...scope,
    pageSetupItems,
    pageSetupRefused: pageSetupItems === null,
    syncCount: scope.syncCount + (pageSetupItems === null ? 0 : 1),
  };
}

/**
 * Read section page setup, remembering a host that refuses it.
 *
 * `null` is the answer on Word on the web, and it is not a degraded scan: the
 * section *text* was read in the main transaction and is unaffected. Only the
 * geometry is missing, and only the geometry checks are skipped.
 */
/**
 * The capability set a host refused the page setup under.
 *
 * Remembered per capabilities object for the same reason `refusedCapabilities` is:
 * a new probe is new evidence, so a host that gains `pageSetup` gets a fresh
 * attempt. A module-wide boolean wrote off the whole session on the strength of
 * one capability set, including a host that was never asked.
 */
let pageSetupRefusedCapabilities: AnalysisCapabilities | null = null;

function pageSetupRefusedFor(capabilities: AnalysisCapabilities): boolean {
  return pageSetupRefusedCapabilities === capabilities;
}

async function acquirePageSetup(
  capabilities: AnalysisCapabilities,
): Promise<Array<PageSetupView | null> | null> {
  if (pageSetupRefusedFor(capabilities)) return null;
  try {
    return await runInWord(async (context) => {
      const sections = context.document.sections;
      sections?.load?.("items");
      await context.sync();
      const items = Array.isArray(sections?.items) ? (sections.items as Office.Section[]) : [];
      items.forEach((section) => {
        PAGE_SETUP_PROPERTIES.forEach((property) => section.load?.([`pageSetup/${property}`]));
      });
      await context.sync();
      return items.map((section) => (section.pageSetup ?? null) as PageSetupView | null);
    });
  } catch (error: unknown) {
    /*
     * Expected on Word on the web, so it is a warning and not an error: the
     * property is genuinely absent there rather than unexpectedly broken. The
     * acquisition still reports the `sections` scope as unexamined, so a web
     * host cannot be read as page-setup compliant.
     */
    pageSetupRefusedCapabilities = capabilities;
    logger.warn("Section page setup is not available on this host", {
      ...describeError(error),
    });
    return null;
  }
}

/** Reset the remembered page-setup refusal. See `__resetRefusedCapabilities`. */
export function __resetPageSetupRefusal(): void {
  pageSetupRefusedCapabilities = null;
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
  /*
   * The policy is resolved *before* the load plan, because the plan is what the
   * policy decides.
   *
   * It used to be derived afterwards, and the scope was never passed to
   * `planAcquisitionLoads` at all — so `includeTables`, `includeSections` and
   * `includeHeadersFooters` were read by nobody, and every scan requested all
   * three structural scopes whatever the governance author had switched off. A
   * scope policy that cannot stop a read is not a scope policy.
   */
  const policy = options.policy ?? createGovernanceProfile(options.profile);
  // A remembered refusal is honoured for the same capability set only. A new
  // probe result is new evidence, so it gets a new attempt at the rich scope.
  let plan = planAcquisitionLoads(
    options.capabilities,
    richScopeRefusedFor(options.capabilities),
    policy.scope,
  );
  let acquired: AcquiredScope;
  try {
    acquired = await acquireScope(plan, maxChars, options.capabilities);
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
    plan = planAcquisitionLoads(options.capabilities, true, policy.scope);
    acquired = await acquireScope(plan, maxChars, options.capabilities);
  }

  // The plan travels with the acquired scope. The builders read properties
  // through it, so a degraded scope is honoured all the way to the DTO rather
  // than only at the point of the request.
  const snapshot = buildSnapshot(acquired, maxChars, plan);
  const formatting = buildFormatting(acquired, maxChars, plan);
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
    syncCount: acquired.syncCount,
    analyzedCharacterCount: acquired.analysisText.length,
    completeDocumentCharacterCount: acquired.fullText.length,
    fullBodyReadCount: 1,
    paragraphCollectionRead: acquired.paragraphItems.length > 0,
    structuralCoverage: acquired.paragraphItems.length > 0 ? "partial" : "unsupported",
    // Properties this host would not serve are named here, so a text-only
    // result is never reported as though it were a formatting-aware one.
    //
    // Derived from what the plan actually skipped, never from a constant list.
    // The previous version named `tables`, `headers`, `footers` and `sections`
    // unconditionally, so a host that served all four — and a scan that compared
    // them — still reported every one of them as unsupported, and coverage then
    // refused to call the run complete on the strength of a gap that had been
    // closed. `NEVER_ACQUIRED_SCOPES` is the part that is genuinely constant,
    // and it says so.
    unsupported: [
      ...(acquired.paragraphItems.length > 0 ? [] : ["wordParagraphCollection"]),
      ...plan.skipped,
      /*
       * A host that served the sections but refused the page setup has not been
       * examined for page geometry, so `sections` is named here. `coverage.ts`
       * counts the scope from this list, and without the token it read a web host
       * as page-setup compliant on a scan that never checked it.
       */
      ...(acquired.pageSetupRefused ? ["pageSetup", "sections"] : []),
    ],
    // Reported, but never as a host limitation: `coverage.ts` maps `unsupported`
    // to `unsupportedByHost`, and a scope ToneForge chose not to read is not
    // something a different Word would serve.
    notAttempted: [...plan.notAttempted],
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

/** What the DTO builders need, so neither re-declares the acquired shape. */
type AcquiredForBuilders = Omit<AcquiredScope, "syncCount">;

function buildSnapshot(
  acquired: AcquiredForBuilders,
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
  /*
   * One node per structural object the scan read.
   *
   * Spec §20 counts *what was examined*, and `coverage.ts` counts a table, a
   * section or a header/footer by looking for a node of that type. Without these
   * nodes a scan that read every table in the document reported
   * `tablesExamined: 0` — which reads as "the document has no tables", the exact
   * false-compliance claim §9 exists to prevent, produced by the count rather
   * than by any decision.
   *
   * `editable: false` on all of them, and that is a real answer rather than a
   * placeholder. `revisionAdapter` refuses table, section and header/footer
   * mutation (spec §8.3), and the corresponding findings are all marked
   * `correctable: false`; a node claiming to be editable would let a planner
   * target it. They are `includedInGovernance` so the *checks* still run — the
   * object is examined, it is simply not something this pass may change.
   */
  acquired.tableItems?.forEach((_table, index) => {
    const sourcePath = `body/table/${index}`;
    const nodeId = buildNodeId("table", sourcePath);
    nodes.push({
      nodeId,
      type: "table",
      sourcePath,
      editable: false,
      includedInGovernance: true,
      includedInAIReview: false,
      protectionReason: "read-only-scope",
    });
  });
  acquired.sectionItems?.forEach((_section, index) => {
    const sourcePath = `body/section/${index}`;
    const nodeId = buildNodeId("section", sourcePath);
    nodes.push({
      nodeId,
      type: "section",
      sourcePath,
      editable: false,
      includedInGovernance: true,
      includedInAIReview: false,
      protectionReason: "read-only-scope",
    });
  });
  acquired.sectionItems?.forEach((section, sectionIndex) => {
    section.headerFooters.forEach((headerFooter, slotIndex) => {
      const sourcePath = `body/section/${sectionIndex}/${headerFooter.kind}/${headerFooter.slot}`;
      const nodeId = buildNodeId("headerFooter", sourcePath);
      nodes.push({
        nodeId,
        type: headerFooter.kind === "header" ? "header" : "footer",
        text: headerFooter.text,
        sourcePath,
        editable: false,
        includedInGovernance: true,
        includedInAIReview: false,
        protectionReason: "read-only-scope",
      });
      void slotIndex;
    });
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
      unsupported: [
        ...(acquired.paragraphItems.length > 0 ? [] : ["wordParagraphCollection"]),
        ...plan.skipped,
        ...(acquired.pageSetupRefused ? ["pageSetup", "sections"] : []),
      ],
    },
    nodes,
  });
}

function buildFormatting(
  acquired: AcquiredForBuilders,
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
     * The flow controls are never read.
     *
     * `Word.Paragraph` exposes no `paragraphFormat`, so there is nothing to load
     * them through — see `CAPABILITY_PROPERTY_GROUPS`. They are reported as
     * `null`, the same "not read" answer `pageBreakBefore` gets below, rather
     * than being named as host-unsupported: no host has declined to serve a
     * property this acquisition never asked for, and blaming the host for a
     * scope ToneForge chose is the mistake the unsupported-property list exists
     * to avoid.
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
      /*
       * Always `null`, and deliberately never requested.
       *
       * There is no property path to them. `keepWithNext` and `keepTogether` are
       * properties of `Word.ParagraphFormat`, which the JavaScript API reaches
       * only through a style — `Word.Style.paragraphFormat` and
       * `Word.ConditionalStyle.paragraphFormat` are its documented users — and
       * `Word.Paragraph` exposes no `paragraphFormat` of its own to read a
       * paragraph's own values with. `pageBreakBefore` has no home there either.
       *
       * So the flow controls are reported as "not read" rather than being loaded
       * by a name the API does not have, which would cost the whole
       * paragraph-format family rather than the three values. The analyzer skips
       * these comparisons rather than inventing a value.
       */
      keepNext: null,
      keepLines: null,
      /*
       * Always `null`, and deliberately never requested.
       *
       * `pageBreakBefore` is a `Word.Paragraph` property in the VBA and
       * interop object models, but the JavaScript `Word.ParagraphFormat` — the
       * only documented place a paragraph's pagination settings live — has no
       * such property. Asking for a name the API does not have gets the whole
       * request rejected, so the field stays "not read" and the analyzer skips
       * the comparison rather than inventing a value for it.
       */
      pageBreakBefore: null,
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
    tables: buildTables(acquired.tableItems),
    sections: buildSections(acquired.sectionItems, acquired.pageSetupItems),
    headersFooters: buildHeaderFooters(acquired.sectionItems),
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

/**
 * Spec §8.3. A table the scan read, and the properties it could not.
 *
 * `columnCount` is derived from `values`, not read: `Word.TableLoadOptions` has
 * no column-count member, and the row arrays are the only evidence of width on
 * the load options above. A table with no values reports `null` — "not read" —
 * rather than zero, so a ragged table is not reported as a zero-column one.
 *
 * `headerRow` is likewise not read. `Word.Table` exposes `headerRowCount` and a
 * first-row *is* a header row only by convention; there is no boolean for it, so
 * the DTO field stays `null` and `checkTableFormatting` skips that comparison
 * rather than inferring a structural claim from a row count.
 */
function buildTables(items: TableView[] | null): TableSnapshot[] {
  return (items ?? []).map((table, index) => {
    const sourcePath = `body/table/${index}`;
    const columnCount = Array.isArray(table.values)
      ? table.values.reduce((widest, row) => Math.max(widest, row.length), 0)
      : null;
    return {
      index,
      nodeId: buildNodeId("table", sourcePath),
      sourcePath,
      text: (table.values ?? []).map((row) => row.join("\t")).join("\n"),
      styleName: fontValue(table.style) ?? fontValue(table.styleBuiltIn),
      // Not read: see the doc comment. `cellStyleName` likewise — `Word.Table`
      // has no cell style member on its load options.
      headerRow: null,
      headerRowCount: numberOrNull(table.headerRowCount),
      cellStyleName: null,
      rowCount: numberOrNull(table.rowCount),
      columnCount: numberOrNull(columnCount),
    };
  });
}

/**
 * Spec §8.5. A section and the page geometry the profile can compare.
 *
 * `orientation` is normalised rather than passed through: Word reports
 * `portrait`/`landscape` as strings, and a host that spells it differently
 * should read as "not read" instead of as a permanent mismatch against the
 * profile. Every geometry field is `null` on Word on the web, where
 * `Section.pageSetup` does not exist — and a `null` is what makes
 * `checkPageSetup` skip rather than invent a deviation.
 */
function buildSections(
  sections: SectionView[] | null,
  pageSetup: Array<PageSetupView | null> | null,
): SectionSnapshot[] {
  return (sections ?? []).map((section, index) => {
    const sourcePath = `body/section/${index}`;
    const setup = pageSetup?.[index] ?? null;
    return {
      index,
      nodeId: buildNodeId("section", sourcePath),
      sourcePath,
      text: section.text,
      orientation: normalizeOrientation(setup?.orientation),
      margins: {
        top: numberOrNull(setup?.topMargin),
        bottom: numberOrNull(setup?.bottomMargin),
        left: numberOrNull(setup?.leftMargin),
        right: numberOrNull(setup?.rightMargin),
      },
      width: numberOrNull(setup?.pageWidth),
      height: numberOrNull(setup?.pageHeight),
    };
  });
}

/**
 * Spec §8.4. One entry per header or footer slot of every section.
 *
 * `required` is *presence*, not a profile claim: Word serves a blank body for a
 * header the document does not have, so a non-empty text is the only evidence
 * that a header exists. That is the honest reading of the profile's
 * `headersFooters.required` field, which asks whether the document should have
 * one.
 *
 * A blank slot still produces an entry, and its font fields are `null` — the
 * analyzer skips a comparison it has no evidence for, and a blank header does
 * not become a finding about a font nobody set.
 */
function buildHeaderFooters(sections: SectionView[] | null): HeaderFooterSnapshot[] {
  const entries: HeaderFooterSnapshot[] = [];
  (sections ?? []).forEach((section, sectionIndex) => {
    section.headerFooters.forEach((headerFooter, slotIndex) => {
      const sourcePath = `body/section/${sectionIndex}/${headerFooter.kind}/${headerFooter.slot}`;
      const text = headerFooter.text ?? "";
      entries.push({
        index: entries.length,
        nodeId: buildNodeId("headerFooter", sourcePath),
        sourcePath,
        kind: headerFooter.kind,
        text,
        styleName: fontValue(headerFooter.styleName),
        required: text.trim().length > 0,
        ...(headerFooter.font === undefined
          ? {}
          : {
              font: {
                name: fontValue(headerFooter.font.name),
                size: numberOrNull(headerFooter.font.size),
                color: fontValue(headerFooter.font.color),
                bold: headerFooter.font.bold ?? null,
                italic: headerFooter.font.italic ?? null,
                underline: headerFooter.font.underline ?? null,
              },
            }),
      });
      void slotIndex;
    });
  });
  return entries;
}

/**
 * Word's page orientation, or `null` when the host spelled it something else.
 *
 * `null` is the answer that keeps a comparison honest: the analyzer skips a
 * property it did not read, where an unmapped string would be reported as a
 * deviation from a profile the document may well satisfy.
 */
function normalizeOrientation(value: string | undefined): "portrait" | "landscape" | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "portrait" || normalized === "landscape") return normalized;
  return null;
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
 * Paragraph indentation properties carried through the DTO.
 *
 * Grouped because they share one truthiness rule: Word reports `false` and `0`
 * for a real value, so the absence of a value is the only thing that becomes
 * `null`. The pagination settings are *not* in this list — they have no
 * property path on `Word.Paragraph`, so they are never read at all.
 */
const PLANNED_FLOW_PROPERTIES = ["leftIndent", "rightIndent", "firstLineIndent"] as const;

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fontValue(value: string | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
