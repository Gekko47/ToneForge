/**
 * Whether a structural standard will be compared, and which half decides it.
 *
 * **The defect this module exists to close.** Each structural standard used to
 * carry a `supported: z.boolean()` that a user set from the profile editor, and
 * the analyzer gated on `standard.supported && capabilities.supportsTables`.
 * The flag was named after a property of the *host* but was authored by a
 * *person*: ticking "check tables" asserted something about the Word install
 * that the person ticking it cannot know and did not mean. The flag also
 * duplicated the capability gate that was already right beside it, so the same
 * question — "can this host read tables?" — had two answers, and only one of
 * them was derived from anything.
 *
 * **The two halves, kept apart.** `requested` is the house's decision and lives
 * in the profile. `enabled` is a fact about this Word host and is derived here
 * from the probed capabilities, so no user can assert it and no stored profile
 * can claim it. A standard is compared only when both hold, which is what spec
 * §9 calls `requested ∩ host-supported` — the same intersection
 * `analysis/deterministic/coverage.ts` computes for scopes, applied to
 * standards so the two cannot drift apart in wording or in effect.
 *
 * **Why the capability shape is declared here.** `FormattingCapabilities` in
 * `analyzer.ts` and `WordCapabilities` in `word/capabilityProbe.ts` both satisfy
 * this interface structurally. Declaring the minimum shape locally keeps
 * `src/formatting` inside its deterministic boundary (no import from `analysis`
 * or `word`) and lets the task pane pass a full `WordCapabilities` without a
 * cast.
 */

export type StructuralStandardFamily = "lists" | "tables" | "headersFooters" | "page";

export const STRUCTURAL_STANDARD_FAMILIES: readonly StructuralStandardFamily[] = [
  "lists",
  "tables",
  "headersFooters",
  "page",
];

/** The minimum capability shape the derivation reads. */
export interface StructuralStandardCapabilities {
  supportsListLevel: boolean;
  supportsTables?: boolean;
  supportsHeadersFooters?: boolean;
  supportsSections?: boolean;
}

/** Which host capability decides each family. */
export const STRUCTURAL_STANDARD_CAPABILITY: Readonly<
  Record<StructuralStandardFamily, keyof StructuralStandardCapabilities>
> = {
  lists: "supportsListLevel",
  tables: "supportsTables",
  headersFooters: "supportsHeadersFooters",
  page: "supportsSections",
};

/**
 * What every structural standard has in common.
 *
 * The profile schemas declare `requested` as a required boolean (it has a
 * default), but the editor and the analyzer both pass the section itself, which
 * may be absent entirely. Reading it through this shape keeps one code path for
 * "no standard authored" and "standard authored but not asked for" — two states
 * that must behave identically, because neither is checked.
 */
export interface StructuralStandardRequest {
  readonly requested?: boolean | undefined;
}

/** What the house asked for. Never a statement about the host. */
export function standardIsRequested(standard: StructuralStandardRequest | undefined): boolean {
  return standard?.requested === true;
}

/**
 * What this host can actually read.
 *
 * A flag that is absent is treated as `false`, not as unknown-but-assumed-yes:
 * `supportsTables` is optional on `FormattingCapabilities` precisely so a host
 * that never claimed it cannot be read as supporting it. The capability probe
 * defaults every Office.js-dependent family to `false` for the same reason.
 */
export function standardIsEnabled(
  family: StructuralStandardFamily,
  capabilities: StructuralStandardCapabilities,
): boolean {
  return capabilities[STRUCTURAL_STANDARD_CAPABILITY[family]] === true;
}

/** The conjunction the analyzer gates on: asked for, and readable here. */
export function standardIsChecked(
  family: StructuralStandardFamily,
  standard: StructuralStandardRequest | undefined,
  capabilities: StructuralStandardCapabilities,
): boolean {
  return standardIsRequested(standard) && standardIsEnabled(family, capabilities);
}

/** The reader's name for each family, and why it is not read in this host. */
export const STRUCTURAL_STANDARD_LABELS: Readonly<
  Record<StructuralStandardFamily, { label: string; reason: string }>
> = {
  lists: {
    label: "List level",
    reason:
      "this Word version does not serve a list item's level, so a level set here is stored but never compared. The list style is still compared.",
  },
  tables: {
    label: "Tables",
    reason:
      "this Word version cannot read table properties, so a table standard set here is stored but not compared.",
  },
  headersFooters: {
    label: "Headers and footers",
    reason:
      "this Word version cannot read headers and footers, so a header standard set here is stored but not compared.",
  },
  page: {
    label: "Page setup",
    reason:
      "this Word version cannot read section page setup, so margins and orientation set here are stored but not compared.",
  },
};

/**
 * The families this host cannot read, in the order the editor shows them.
 *
 * `null` capabilities means the probe has not answered. That is a third state
 * and not `false`: marking a standard unreadable before the probe ran would be
 * a claim about the host nobody made, so this returns nothing rather than
 * everything.
 */
export function familiesNotEnabled(
  capabilities: StructuralStandardCapabilities | null,
): StructuralStandardFamily[] {
  if (capabilities === null) return [];
  return STRUCTURAL_STANDARD_FAMILIES.filter((family) => !standardIsEnabled(family, capabilities));
}
