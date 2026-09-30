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
const ACQUISITION_TOKEN_TO_SCOPE: Readonly<Record<string, ScopeKind>> = {
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
};

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
  const supported: ScopeKind[] = [];
  const unsupported: ScopeKind[] = [];

  const capabilities = context.capabilities as unknown as Record<string, boolean | undefined>;
  SCOPE_KINDS.forEach((kind) => {
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
  const excludedScopes = requested.filter(
    (scope) => !host.supported.includes(scope) && !context.acquisition.unsupported.includes(scope),
  );

  const nodesByType = (type: string): number =>
    examinedNodeIds.filter(
      (nodeId) => context.nodes.find((node) => node.nodeId === nodeId)?.type === type,
    ).length;

  const paragraphsExamined = nodesByType("paragraph");
  const headingsExamined = nodesByType("heading");
  const listsExamined = nodesByType("listItem");
  const tablesExamined = nodesByType("table");
  const sectionsExamined = nodesByType("section");
  const headersFootersExamined = nodesByType("headerFooter");
  const protectedScopes = context.nodes.some(
    (node) => !node.includedInGovernance && node.protectionReason !== undefined,
  )
    ? requested.filter((scope) => scope === "body" || scope === "headings")
    : [];

  const blockers: CoverageBlocker[] = [];
  requested
    .filter((scope) => !examinedScopes.includes(scope))
    .forEach((scope) => {
      const isUnsupported = host.unsupported.includes(scope);
      blockers.push(
        CoverageBlockerSchema.parse({
          scope,
          reason: isUnsupported
            ? `${scope} could not be read in this Word host`
            : `${scope} was in scope but was not examined`,
          cause: isUnsupported ? "unsupportedByHost" : "excludedByPolicy",
        }),
      );
    });

  // A narrowed run cannot speak for the document. This is the check that stops
  // an incremental scan reporting whole-document compliance, and it is separate
  // from the scope comparison because a narrowed run can have every scope
  // "examined" and still have looked at a fraction of the nodes.
  if (examinedNodeIds.length < context.nodes.length) {
    const skipped = context.nodes.length - examinedNodeIds.length;
    if (!blockers.some((blocker) => blocker.scope === "body")) {
      blockers.push(
        CoverageBlockerSchema.parse({
          scope: "body",
          reason: `This run examined ${examinedNodeIds.length} of ${context.nodes.length} acquired nodes; ${skipped} were not looked at`,
          cause: "excludedByPolicy",
        }),
      );
    }
  }

  const complete =
    examinedScopes.length === requested.length &&
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
