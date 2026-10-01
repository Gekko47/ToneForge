/**
 * Deterministic coverage.
 *
 * Spec §9 and §20. Scope means `requested ∩ host-supported`, and the report
 * states which of those held. This is a *projection* of the shared
 * `CoverageReport` rather than a second source of truth: the shared report
 * already records what acquisition read and what it skipped, and duplicating
 * those fields here is how the two copies drift — the failure the shared
 * report's own `coverage` field documents when it replaced a hand-maintained
 * duplicate.
 *
 * The one thing this adds is the distinction spec §9 asks for between a scope
 * the *policy* excluded and one the *host* could not serve. Those have
 * different remedies, and collapsing them into one "not checked" line sends the
 * reader to a setting that will not help.
 */

import type { AnalysisContext } from "../analysisContext";
import type { CoverageReport } from "../../core/domain/DocumentSnapshot";
import {
  CoverageBlockerSchema,
  DeterministicCoverageSchema,
  SCOPE_KINDS,
  type CoverageBlocker,
  type ScopeKind,
} from "./contracts";

/** How a scope policy flag maps onto a coverage scope. */
const SCOPE_FROM_POLICY: Readonly<Record<string, ScopeKind>> = {
  includeBody: "body",
  includeLists: "lists",
  includeTables: "tables",
  includeSections: "sections",
  includeHeadersFooters: "headersFooters",
  includeTextBoxes: "textBoxes",
  includeFields: "fields",
  includeContentControls: "contentControls",
  includeShapes: "shapes",
};

/**
 * The acquisition diagnostic tokens this module recognises as scope names.
 *
 * Acquisition reports what it could not read as free strings (`tables`,
 * `headers`, `sections`, …). Matching on that vocabulary is the coupling
 * between the two modules, and it is deliberate: a token acquisition stops
 * emitting must be added here, or the scope will report as complete while the
 * host was in fact unable to serve it — the exact false-compliance claim spec
 * §9 exists to prevent. A token that appears here and is not in `SCOPE_KINDS`
 * is ignored rather than guessed at.
 */
/** The scope names, keyed by the lowercased acquisition token that names them. */
const ACQUISITION_TOKEN_TO_SCOPE: Readonly<Record<string, ScopeKind>> = Object.fromEntries(
  Object.entries({
    tables: "tables",
    headers: "headersFooters",
    footers: "headersFooters",
    headersFooters: "headersFooters",
    sections: "sections",
    textBoxes: "textBoxes",
    fields: "fields",
    contentControls: "contentControls",
    controls: "contentControls",
    shapes: "shapes",
    images: "shapes",
    smartArt: "shapes",
  } satisfies Record<string, ScopeKind>).map(([token, scope]) => [token.toLowerCase(), scope]),
);

/**
 * Capability names whose absence means a scope cannot be examined.
 *
 * Typed against `string` rather than `keyof AnalysisCapabilities` because the
 * three flags a scope needs (`supportsTables`, `supportsHeadersFooters`,
 * `supportsSections`) are added in T11, with this module. Indexing into the
 * capability object by a plain string keeps the lookup honest in the meantime:
 * a flag that does not exist yet reads as `undefined`, which is not `false`, so
 * the scope is not marked unsupported on the strength of a field that has not
 * been added. Acquisition's own `unsupported` list is what marks them until
 * then.
 */
const SCOPE_CAPABILITY: Readonly<Partial<Record<ScopeKind, string>>> = {
  tables: "supportsTables",
  headersFooters: "supportsHeadersFooters",
  sections: "supportsSections",
};

export interface DeterministicCoverageInput {
  context: AnalysisContext;
  /** The shared coverage report, when the caller built one. */
  coverage?: CoverageReport | null;
  /** The nodes this run examined. Defaults to every acquired node. */
  examinedNodeIds?: readonly string[];
  /**
   * True when the caller examined a strict subset of the document.
   *
   * Declared rather than derived, because the observer hands this module a
   * context whose `nodes` have *already* been narrowed to the examined ones. The
   * shortfall check below compares `examinedNodeIds` against `context.nodes`, so
   * on that path the two are equal by construction and an incremental scan
   * examining one paragraph of fifty reported itself complete — the exact
   * false-compliance claim spec §9 exists to prevent.
   */
  incremental?: boolean;
  /** Why the run was partial, in the user's terms. */
  incrementalReason?: string;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function intersect(a: readonly ScopeKind[], b: readonly ScopeKind[]): ScopeKind[] {
  const set = new Set(b);
  return a.filter((scope) => set.has(scope));
}

/**
 * The scopes the policy asks for.
 *
 * `body` and `headings` are separated because the body scope covers body text
 * while heading comparison is its own rule set, and a document whose headings
 * were not examined is not fully checked even when every body paragraph was.
 */
export function requestedScopes(context: AnalysisContext): ScopeKind[] {
  const scope = context.policy.scope;
  const requested = SCOPE_KINDS.filter((kind) => {
    if (kind === "headings") return scope.includeBody;
    const flag = Object.entries(SCOPE_FROM_POLICY).find(([, value]) => value === kind)?.[0];
    return flag === undefined ? false : scope[flag as keyof typeof scope] === true;
  });
  return requested;
}

/** The scopes the host could actually serve, from capabilities and diagnostics. */
export function hostSupportedScopes(context: AnalysisContext): {
  supported: ScopeKind[];
  unsupported: ScopeKind[];
} {
  const unsupportedTokens = new Set(
    context.acquisition.unsupported.map((token) => token.toLowerCase()),
  );
  /*
   * Scopes acquisition declined to attempt, kept out of the host verdict.
   *
   * A scope the policy excluded, or one this pass has no reader for, is not
   * something a different Word would serve. Mapping it to `unsupportedByHost`
   * sent the reader to a remedy that cannot work; it belongs with the excluded
   * scopes, which the policy path already reports.
   */
  const notAttemptedTokens = new Set(
    (context.acquisition.notAttempted ?? []).map((token) => token.toLowerCase()),
  );
  const supported: ScopeKind[] = [];
  const unsupported: ScopeKind[] = [];

  const capabilities = context.capabilities as unknown as Record<string, boolean | undefined>;
  SCOPE_KINDS.forEach((kind) => {
    if (
      unique([...notAttemptedTokens]).some((token) => ACQUISITION_TOKEN_TO_SCOPE[token] === kind)
    ) {
      return;
    }
    const capability = SCOPE_CAPABILITY[kind];
    const capabilityMissing = capability !== undefined && capabilities[capability] === false;
    const acquisitionMissing = unique([...unsupportedTokens]).some(
      (token) => ACQUISITION_TOKEN_TO_SCOPE[token] === kind,
    );
    if (capabilityMissing || acquisitionMissing) unsupported.push(kind);
    else supported.push(kind);
  });

  return { supported, unsupported };
}

/**
 * A stable digest of what was examined.
 *
 * Spec §16 makes this part of the review-session fingerprint, so it has to be a
 * pure function of the examined scope rather than of the run — two runs over
 * the same scope must produce the same string, or a re-scan would invalidate
 * every approval the user had made.
 */
export function coverageFingerprint(input: {
  examinedScopes: readonly ScopeKind[];
  paragraphsExamined: number;
  tablesExamined: number;
  sectionsExamined: number;
  headersFootersExamined: number;
}): string {
  return [
    [...input.examinedScopes].sort().join(","),
    `p${input.paragraphsExamined}`,
    `t${input.tablesExamined}`,
    `s${input.sectionsExamined}`,
    `h${input.headersFootersExamined}`,
  ].join("|");
}

/**
 * Build the deterministic coverage projection.
 *
 * `complete` is `requested ⊆ examined`. That is the whole point of the model:
 * a run that examined everything and found nothing is complete, and a run that
 * examined a third of the document and found nothing is not. Deriving it from
 * the finding count instead is the defect that let a partial scan report a
 * clean document.
 */
export function buildDeterministicCoverage(
  input: DeterministicCoverageInput,
): ReturnType<typeof DeterministicCoverageSchema.parse> {
  const { context } = input;
  const requested = requestedScopes(context);
  const host = hostSupportedScopes(context);
  const examinedNodeIds =
    input.examinedNodeIds === undefined
      ? context.nodes.filter((node) => node.includedInGovernance).map((node) => node.nodeId)
      : [...input.examinedNodeIds];

  // A scope the host cannot serve is never examined, whatever the policy says.
  const examinable = intersect(requested, host.supported);
  const examinedScopes = intersect(examinable, requested);
  /*
   * Asked for, servable, and not examined — nothing else.
   *
   * The previous filter compared `ScopeKind` values against the *raw acquisition
   * tokens*, which are a different vocabulary: `body`, `headings` and `lists` are
   * never emitted as tokens, so the exclusion test was answering a question
   * about a different set and could not do what its name says. It also kept the
   * scopes the host *cannot* serve, which belong in `unsupportedScopes` and are
   * already reported there with their own remedy.
   *
   * Derived from the two lists that are already computed, so a scope cannot be
   * simultaneously excluded here and examined there.
   */
  const excludedScopes = requested.filter((scope) => !examinedScopes.includes(scope));

  const nodesByType = (...types: readonly string[]): number =>
    examinedNodeIds.filter((nodeId) => {
      const type = context.nodes.find((node) => node.nodeId === nodeId)?.type;
      return type !== undefined && types.includes(type);
    }).length;

  const paragraphsExamined = nodesByType("paragraph");
  const headingsExamined = nodesByType("heading");
  const listsExamined = nodesByType("listItem");
  const tablesExamined = nodesByType("table");
  const sectionsExamined = nodesByType("section");
  /*
   * Two node types, one scope.
   *
   * `DocumentNodeSchema` keeps Word's own distinction between a header and a
   * footer — they are separate objects with separate `getHeader`/`getFooter`
   * entries — while the scope policy and the coverage report treat them as one
   * `headersFooters` scope, because §8.4 gates them together. Summing the two
   * here is what reconciles those, and a `headerFooter` node type was the
   * alternative: it would have made this a count of one type while every
   * acquisition emitted two.
   */
  const headersFootersExamined = nodesByType("header", "footer");
  const protectedScopes = context.nodes.some(
    (node) => !node.includedInGovernance && node.protectionReason !== undefined,
  )
    ? requested.filter((scope) => scope === "body" || scope === "headings")
    : [];

  /*
   * The scopes the author will not accept a partial answer for.
   *
   * `body` is added unconditionally, and it is added here rather than left to the
   * policy: a run that examined part of the body cannot speak for the document,
   * and a policy that chose otherwise would be a setting that disables the one
   * guarantee the coverage report exists to make.
   *
   * Every *requested* scope that went unexamined is still recorded — as a
   * blocker when it is mandatory, and as an `excludedScopes` entry when it is
   * not. That split is the whole of §27 gate 12. Before it, every unexamined
   * scope became a blocker, so a document whose tables the host could not read
   * reported "Incomplete" with a reason pointing at a host limitation the user
   * cannot change; the user's only response was to learn that "Incomplete" is
   * normal, which is how a genuine partial scan gets believed.
   */
  const mandatory = new Set<ScopeKind>(["body", ...context.policy.scope.mandatoryScopes]);

  const blockers: CoverageBlocker[] = [];
  requested
    .filter((scope) => !examinedScopes.includes(scope))
    .forEach((scope) => {
      if (!mandatory.has(scope)) return;
      const isUnsupported = host.unsupported.includes(scope);
      blockers.push(
        CoverageBlockerSchema.parse({
          scope,
          reason: isUnsupported
            ? `${scope} is required but could not be read in this Word host`
            : `${scope} is required but was not examined`,
          cause: isUnsupported ? "unsupportedByHost" : "excludedByPolicy",
        }),
      );
    });

  // A narrowed run cannot speak for the document. This is the check that stops
  // an incremental scan reporting whole-document compliance, and it is separate
  // from the scope comparison because a narrowed run can have every scope
  // "examined" and still have looked at a fraction of the nodes.
  const shortfall = Math.max(0, context.nodes.length - examinedNodeIds.length);
  if (input.incremental === true || shortfall > 0) {
    /*
     * Two routes to the same blocker, and both are needed.
     *
     * `shortfall` covers a caller that acquired the whole document and then
     * narrowed the examined set. `incremental` covers the observer, which
     * narrows `context.nodes` itself before calling — there the two counts are
     * equal by construction, so the arithmetic above is always zero and the run
     * would otherwise report itself complete on the strength of a scope
     * comparison it never made against the rest of the document.
     */
    const reason =
      shortfall > 0
        ? `This run examined ${examinedNodeIds.length} of ${context.nodes.length} acquired nodes; ${shortfall} were not looked at`
        : (input.incrementalReason ??
          "This run examined only the nodes Word reported as changed; the rest of the document was not looked at.");
    if (!blockers.some((blocker) => blocker.scope === "body")) {
      blockers.push(
        CoverageBlockerSchema.parse({
          scope: "body",
          reason,
          cause: "excludedByPolicy",
        }),
      );
    }
  }

  /*
   * What `complete` means, stated once.
   *
   * It is *not* "everything requested was examined". A document whose tables the
   * host cannot read is fully examined for everything it *can* read, and calling
   * that incomplete would train the user to ignore the word — which is how a
   * genuine partial scan gets believed. It is "nothing the author insisted on is
   * missing, and this run saw the whole document": a mandatory blocker, a
   * narrowed node set, or a run the caller declared incremental each make it
   * false, for a reason the blocker list states in the user's terms.
   *
   * The old `examinedScopes.length === requested.length` condition was the
   * second half of that, and it meant a table-capability gap on an otherwise
   * perfect scan reported "Incomplete" with no blocker to explain why.
   */
  const complete =
    input.incremental !== true &&
    examinedNodeIds.length >= context.nodes.length &&
    blockers.length === 0;

  return DeterministicCoverageSchema.parse({
    requestedScopes: requested,
    examinedScopes,
    unsupportedScopes: host.unsupported,
    excludedScopes,
    protectedScopes,
    textCharactersExamined: context.text.length,
    paragraphsExamined,
    headingsExamined,
    listsExamined,
    tablesExamined,
    sectionsExamined,
    headersFootersExamined,
    complete,
    blockers,
    coverageFingerprint: coverageFingerprint({
      examinedScopes,
      paragraphsExamined,
      tablesExamined,
      sectionsExamined,
      headersFootersExamined,
    }),
  });
}
