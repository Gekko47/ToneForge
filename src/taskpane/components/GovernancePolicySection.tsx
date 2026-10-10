import React from "react";
import {
  Button,
  Checkbox,
  Dropdown,
  Field,
  Input,
  MessageBar,
  Option,
} from "@fluentui/react-components";
import { v4 as uuidv4 } from "uuid";
import {
  GOVERNANCE_RULE_SOURCES,
  scopeForSource,
  type GovernanceProfile,
  type GovernanceRule,
  type ProtectionPolicy,
  type ScopePolicy,
} from "../../core/domain/GovernanceProfile";
import { updateGovernancePolicy } from "../../core/state/persistence";
import { useConfirmDialog } from "./common/ConfirmDialog";
import { useToaster } from "./common/useToast";

/**
 * Authoring for the normative half of the policy contract.
 *
 * `rules`, `terminology`, `scope`, `protection`, and `editorial` were modelled,
 * given precedence over learned evidence by `resolveResolvedPolicy`, and
 * written by nobody. Every one of them was permanently the schema default, and
 * `ChangePlan` cited a `governancePolicyRevision` for a policy that could not
 * differ from any other. This is the surface that closes that gap.
 *
 * Two asymmetries are deliberate and are the reason this is not a generic
 * settings form:
 *
 * 1. **Protection may be loosened only deliberately.** Every flag protects by
 *    default, and turning one off is stated in the control's own label rather
 *    than inferred from a checkbox. A safety default that can be cleared by
 *    accident is not a default.
 * 2. **Scope cannot exclude everything.** A policy that analyses nothing would
 *    report a clean document over a document nothing looked at, so an
 *    all-excluded policy is refused with an explanation rather than saved.
 */

/** The protection flags the author may change, in the order they are shown. */
const PROTECTION_FLAGS: ReadonlyArray<{
  key: keyof Omit<ProtectionPolicy, "userLockedRanges">;
  label: string;
  detail: string;
  /** Confirm before saving this one switched off. */
  safetyCritical: boolean;
}> = [
  {
    key: "protectQuotedText",
    label: "Never change text inside quotation marks",
    detail: "Quoted text is someone else's words.",
    safetyCritical: true,
  },
  {
    key: "protectTrackedDeletions",
    label: "Never change text marked as a tracked deletion",
    detail: "A deletion a reviewer made is not ours to rewrite.",
    safetyCritical: true,
  },
  {
    key: "protectCaptions",
    label: "Never change captions",
    detail: "Figure and table captions carry numbering the author controls.",
    safetyCritical: true,
  },
  {
    key: "protectComments",
    label: "Never change comment text",
    detail: "Comments are addressed to a person, not edited as prose.",
    safetyCritical: true,
  },
  {
    key: "protectAltText",
    label: "Never change image alt text",
    detail: "Alt text is a description, not body copy.",
    safetyCritical: false,
  },
  {
    key: "protectFootnotes",
    label: "Never change footnotes and endnotes",
    detail: "Notes carry citations that must not drift.",
    safetyCritical: false,
  },
  {
    key: "protectFields",
    label: "Never change field content",
    detail: "Fields are recalculated by Word; editing the result is lost work.",
    safetyCritical: false,
  },
  {
    key: "protectHeadersFooters",
    label: "Never change headers and footers",
    detail: "Off by default because most documents have none.",
    safetyCritical: false,
  },
];

/**
 * The scope policy flags that are booleans.
 *
 * `ScopePolicy` also carries `mandatoryScopes`, which is a list of scope kinds
 * rather than a flag. `BooleanScopeFlag` is the difference, derived rather than
 * written out so a new boolean flag in the schema is usable here without editing
 * this file, and so a checkbox can never be pointed at the list.
 */
type BooleanScopeFlag = {
  [K in keyof ScopePolicy]: ScopePolicy[K] extends boolean ? K : never;
}[keyof ScopePolicy];

/** The scope a mandatory-scope checkbox names. Mirrors `ScopeKind` structurally. */
type MandatoryScope =
  | "headings"
  | "lists"
  | "tables"
  | "sections"
  | "headersFooters"
  | "textBoxes"
  | "fields"
  | "contentControls"
  | "shapes";

/**
 * The scope flags, split by whether turning one on widens or narrows analysis.
 *
 * Narrowing is listed first because it is the destructive direction: every
 * exclusion makes a coverage report smaller, and a policy that excludes enough
 * reads as a clean document.
 *
 * `key` is narrowed to the *boolean* scope flags rather than `keyof ScopePolicy`.
 * `ScopePolicy` also carries `mandatoryScopes`, which is a list, and letting a
 * checkbox bind to it produced a control typed `boolean` rendering a list — a
 * compile error here, and in a looser build a checkbox that toggled nothing.
 */
const SCOPE_FLAGS: ReadonlyArray<{
  key: BooleanScopeFlag;
  label: string;
  widens: boolean;
}> = [
  { key: "includeHeadersFooters", label: "Headers and footers", widens: false },
  { key: "includeComments", label: "Comments", widens: false },
  { key: "includeFootnotesEndnotes", label: "Footnotes and endnotes", widens: false },
  { key: "includeTextBoxes", label: "Text boxes", widens: false },
  { key: "includeShapes", label: "Shapes", widens: false },
  { key: "includeSmartArt", label: "SmartArt", widens: false },
  { key: "includeContentControls", label: "Content controls", widens: false },
  { key: "includeFields", label: "Fields", widens: false },
  { key: "includeImages", label: "Images", widens: false },
  { key: "includeTables", label: "Tables", widens: true },
  // Section geometry. `widens: false` rather than `true`, because the honest
  // description is that it *narrows* the analysis: page setup is checked instead
  // of the whole document being read and compared. Both readings are defensible;
  // listing it under "always included" would put a checkbox there whose default
  // can be turned off, which is the inconsistency the split exists to avoid.
  { key: "includeSections", label: "Page setup and margins", widens: false },
  { key: "includeLists", label: "Lists", widens: true },
  { key: "includeBody", label: "Body text", widens: true },
];

/**
 * The scopes a policy can insist on, and the checkbox label for each.
 *
 * Spec §9 and §27 gate 12. A mandatory scope is one whose absence refuses Apply;
 * every other gap is a limitation the coverage report states and moves past. The
 * distinction is the whole of the control, so it is a visible per-scope choice
 * rather than a hidden constant — and it is only offered for a scope the
 * analysis scope is currently including, since making an excluded scope
 * mandatory is a contradiction the reader could not resolve.
 */
/**
 * Whether the analysis scope currently *includes* a given scope kind.
 *
 * A mandatory scope the policy has excluded is a contradiction — it asks for an
 * examination of content the same policy says to ignore — so the checkbox is
 * disabled rather than silently accepted. `headings` follows `includeBody` and
 * nothing else, because heading comparison has no separate scope flag: §8.2
 * treats a document whose headings were not examined as not fully checked even
 * when every body paragraph was.
 */
function scopeIsIncluded(scope: ScopePolicy, kind: MandatoryScope): boolean {
  switch (kind) {
    case "headings":
      return scope.includeBody;
    case "lists":
      return scope.includeLists;
    case "tables":
      return scope.includeTables;
    case "sections":
      return scope.includeSections;
    case "headersFooters":
      return scope.includeHeadersFooters;
    case "textBoxes":
      return scope.includeTextBoxes;
    case "fields":
      return scope.includeFields;
    case "contentControls":
      return scope.includeContentControls;
    case "shapes":
      return scope.includeShapes;
  }
}

const MANDATORY_SCOPE_FLAGS: ReadonlyArray<{ scope: MandatoryScope; label: string }> = [
  { scope: "headings", label: "Headings must be checked" },
  { scope: "lists", label: "Lists must be checked" },
  { scope: "tables", label: "Tables must be checked" },
  { scope: "sections", label: "Page setup must be checked" },
  { scope: "headersFooters", label: "Headers and footers must be checked" },
  { scope: "textBoxes", label: "Text boxes must be checked" },
  { scope: "fields", label: "Fields must be checked" },
  { scope: "contentControls", label: "Content controls must be checked" },
  { scope: "shapes", label: "Shapes must be checked" },
];

const SOURCE_LABEL: Readonly<Record<(typeof GOVERNANCE_RULE_SOURCES)[number], string>> = {
  typography: "Typography",
  "language.terminology.preferred": "Preferred terminology",
  formatting: "Formatting",
  semantic: "Semantic",
  protection: "Protection",
};

const SEVERITY_OPTIONS = [
  { key: "mandatory", text: "Mandatory — blocks apply until reviewed" },
  { key: "advisory", text: "Advisory — reported, not blocked" },
  { key: "informational", text: "Informational — reported only" },
];

interface RuleDraft {
  id: string;
  source: (typeof GOVERNANCE_RULE_SOURCES)[number];
  description: string;
  severity: GovernanceRule["severity"];
  autoFix: boolean;
}

/**
 * What this page edits.
 *
 * No terminology. Preferred terms, banned terms and required terms were removed
 * from the governance profile: this page governs *protection and editability* —
 * what may be scanned, what may be changed, what must be left alone — while house
 * wording is a deterministic-review standard authored on the style profile.
 *
 * They are not merely moved off this page. Two of the three were read by nothing
 * here or anywhere else, so a user could fill them in and watch nothing happen;
 * the third governed wording from a record whose stated job was safety. The
 * deterministic editor now owns all three.
 */
interface PolicyDraft {
  rules: RuleDraft[];
  protection: ProtectionPolicy;
  scope: ScopePolicy;
}

function ruleToDraft(rule: GovernanceRule): RuleDraft {
  return {
    id: rule.id,
    source: rule.source,
    description: rule.description,
    severity: rule.severity,
    autoFix: rule.autoFix,
  };
}

function toDraft(policy: GovernanceProfile): PolicyDraft {
  return {
    rules: policy.rules.map(ruleToDraft),
    protection: policy.protection,
    scope: policy.scope,
  };
}

/**
 * Why this policy cannot be saved, or null when it can.
 *
 * Exported for the unit test rather than tested through the DOM, because the
 * case that matters — a policy that analyses nothing — is one a test should be
 * able to state directly rather than assemble from twelve checkboxes.
 */
export function policyProblem(draft: PolicyDraft): string | null {
  const excluded = SCOPE_FLAGS.filter((flag) => !draft.scope[flag.key]);
  if (excluded.length === SCOPE_FLAGS.length) {
    return (
      "This scope excludes every kind of content, so a scan would report a clean " +
      "document over a document nothing looked at. Keep at least one category."
    );
  }
  if (!draft.scope.includeBody && excluded.length >= SCOPE_FLAGS.length - 1) {
    return "Keep body text or at least one other content category in scope.";
  }

  const sources = new Set<string>();
  for (const rule of draft.rules) {
    if (rule.description.trim().length === 0) {
      return "Every rule needs a description; an unnamed rule cannot be cited in Pending Changes.";
    }
    if (sources.has(rule.source)) {
      return `Two rules are bound to "${SOURCE_LABEL[rule.source]}". Only one rule governs a category.`;
    }
    sources.add(rule.source);
  }
  return null;
}

export interface GovernancePolicySectionProps {
  policy: GovernanceProfile;
  /** Called with the newly persisted version, so the parent can re-render. */
  onPolicySaved: (policy: GovernanceProfile) => void;
}

export default function GovernancePolicySection({
  policy,
  onPolicySaved,
}: GovernancePolicySectionProps): React.ReactNode {
  const { confirm, dialog } = useConfirmDialog();
  const { toaster, notify } = useToaster();
  const [draft, setDraft] = React.useState<PolicyDraft>(() => toDraft(policy));
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // A protection flag switched off is held until confirmed, so the act of
  // exploring a looser policy cannot itself change what Apply will write.
  const [pendingProtection, setPendingProtection] = React.useState<keyof ProtectionPolicy | null>(
    null,
  );

  // Re-seed when the parent swaps policies (a different profile became active).
  React.useEffect(() => {
    setDraft(toDraft(policy));
    setSavedAt(null);
    setError(null);
  }, [policy]);

  const problem = policyProblem(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(policy));

  function patch(partial: Partial<PolicyDraft>): void {
    setSavedAt(null);
    setError(null);
    setDraft((previous) => ({ ...previous, ...partial }));
  }

  function patchRule(id: string, partial: Partial<RuleDraft>): void {
    patch({ rules: draft.rules.map((rule) => (rule.id === id ? { ...rule, ...partial } : rule)) });
  }

  function addRule(): void {
    // Bound to the first category no rule governs yet, so a new rule is never
    // created in a state where it would be rejected on save.
    const taken = new Set(draft.rules.map((rule) => rule.source));
    const free = GOVERNANCE_RULE_SOURCES.find((source) => !taken.has(source));
    if (free === undefined) {
      setError("Every finding category already has a rule. Edit one instead of adding another.");
      return;
    }
    patch({
      rules: [
        ...draft.rules,
        {
          id: uuidv4(),
          source: free,
          description: "",
          severity: "advisory",
          autoFix: false,
        },
      ],
    });
  }

  /*
   * Removing a rule is destructive: it drops a category's severity and
   * auto-fix behaviour, and the only way back is to author it again. It
   * confirms first (spec §19, ADR-0133) rather than firing on one click.
   */
  async function removeRule(id: string): Promise<void> {
    const rule = draft.rules.find((entry) => entry.id === id);
    const confirmed = await confirm({
      title: "Remove this rule?",
      message: rule
        ? `The rule for "${SOURCE_LABEL[rule.source]}" will be removed. Findings in that category fall back to the learned profile.`
        : "This rule will be removed.",
      confirmLabel: "Remove rule",
      danger: true,
    });
    if (confirmed) {
      // Filter from the latest draft, not the one captured before awaiting the
      // dialog, so changes made while the dialog was open are preserved.
      setDraft((previous) => ({
        ...previous,
        rules: previous.rules.filter((entry) => entry.id !== id),
      }));
    }
  }

  function toggleProtection(key: keyof ProtectionPolicy, checked: boolean): void {
    const flag = PROTECTION_FLAGS.find((entry) => entry.key === key);
    if (flag?.safetyCritical === true && !checked) {
      setPendingProtection(key);
      return;
    }
    patch({ protection: { ...draft.protection, [key]: checked } });
  }

  function confirmProtection(): void {
    if (pendingProtection === null) return;
    patch({ protection: { ...draft.protection, [pendingProtection]: false } });
    setPendingProtection(null);
  }

  function save(): void {
    const issue = policyProblem(draft);
    if (issue !== null) {
      setError(issue);
      return;
    }
    try {
      const next = updateGovernancePolicy(policy.id, {
        ...policy,
        rules: draft.rules.map((rule) => ({
          id: rule.id,
          source: rule.source,
          description: rule.description.trim(),
          scope: scopeForSource(rule.source),
          severity: rule.severity,
          autoFix: rule.autoFix,
          protectedBehavior: "flag" as const,
          remediation: "",
        })),
        protection: draft.protection,
        scope: draft.scope,
      });
      onPolicySaved(next);
      setSavedAt(`Policy saved as version ${next.version}.`);
      // The durable MessageBar below keeps the version visible; the toast is the
      // transient confirmation (spec §20, ADR-0133) that the save landed.
      notify(`Policy saved as version ${next.version}.`, "success");
      setError(null);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <section aria-labelledby="governance-policy-heading">
      {dialog}
      {toaster}
      <h2 id="governance-policy-heading">Governance policy</h2>
      <p className="tf-sub">
        These rules take precedence over the learned style profile. Version {policy.version}. Every
        save creates a new version, and a plan built under an older version is refused at apply
        time.
      </p>

      <section aria-labelledby="policy-rules-heading">
        <h3 id="policy-rules-heading">Rules</h3>
        <p className="tf-sub">
          A rule binds to one kind of finding. With auto-fix off the category is still reported; it
          simply produces no change to apply.
        </p>
        {draft.rules.length === 0 && (
          <p className="tf-sub">No rules. Findings are planned from the learned profile alone.</p>
        )}
        {draft.rules.map((rule) => (
          <div key={rule.id} className="tf-settings-section" aria-label={`Rule for ${rule.source}`}>
            <Field label="Applies to">
              <Dropdown
                value={SOURCE_LABEL[rule.source]}
                selectedOptions={[rule.source]}
                onOptionSelect={(_event, data) => {
                  if (data.optionValue) {
                    patchRule(rule.id, {
                      source: data.optionValue as (typeof GOVERNANCE_RULE_SOURCES)[number],
                    });
                  }
                }}
              >
                {GOVERNANCE_RULE_SOURCES.map((source) => (
                  <Option
                    key={source}
                    value={source}
                    disabled={draft.rules.some(
                      (other) => other.id !== rule.id && other.source === source,
                    )}
                  >
                    {SOURCE_LABEL[source]}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label="Description">
              <Input
                value={rule.description}
                placeholder="House terminology is mandatory"
                onChange={(_event, data) => patchRule(rule.id, { description: data.value })}
              />
            </Field>
            <Field label="Severity">
              <Dropdown
                value={SEVERITY_OPTIONS.find((option) => option.key === rule.severity)?.text ?? ""}
                selectedOptions={[rule.severity]}
                onOptionSelect={(_event, data) => {
                  if (data.optionValue) {
                    patchRule(rule.id, {
                      severity: data.optionValue as GovernanceRule["severity"],
                    });
                  }
                }}
              >
                {SEVERITY_OPTIONS.map((option) => (
                  <Option key={option.key} value={option.key}>
                    {option.text}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Checkbox
              label="Auto-fix findings in this category"
              checked={rule.autoFix}
              onChange={(_event, data) => patchRule(rule.id, { autoFix: data.checked === true })}
            />
            <Button onClick={() => void removeRule(rule.id)}>Remove rule</Button>
          </div>
        ))}
        <Button onClick={addRule} disabled={draft.rules.length >= GOVERNANCE_RULE_SOURCES.length}>
          Add rule
        </Button>
      </section>

      {/*
        No terminology section.

        Preferred terms, banned terms and required terms were here and are gone.
        They are house *wording*, not protection: this page governs what may be
        scanned, what may be changed and what must be left alone, and all three of
        those settings edited the words ToneForge would enforce.

        Two of the three were also read by nothing at all, so the controls could be
        filled in and nothing would happen. They are authored on the deterministic
        style profile now, where the rules that consume them live.
      */}

      <section aria-labelledby="policy-protection-heading">
        <h3 id="policy-protection-heading">Protection</h3>
        <p className="tf-sub">
          Checked items are never changed. Unchecking one is a deliberate decision, and the two
          marked as safety-critical ask first.
        </p>
        {PROTECTION_FLAGS.map((flag) => (
          <Checkbox
            key={flag.key}
            label={flag.label}
            title={flag.detail}
            checked={draft.protection[flag.key]}
            onChange={(_event, data) => toggleProtection(flag.key, data.checked === true)}
          />
        ))}
        {pendingProtection !== null && (
          <div>
            <MessageBar intent="warning">
              {PROTECTION_FLAGS.find((flag) => flag.key === pendingProtection)?.label} will be
              switched off for every scan. Content of this kind may be changed by a previewed,
              applied plan.
            </MessageBar>
            <Button appearance="primary" onClick={confirmProtection}>
              Yes, turn it off
            </Button>
            <Button onClick={() => setPendingProtection(null)}>Keep it protected</Button>
          </div>
        )}
      </section>

      <section aria-labelledby="policy-scope-heading">
        <h3 id="policy-scope-heading">Analysis scope</h3>
        <p className="tf-sub">
          Unchecked categories are excluded from analysis. Excluded content is named in the coverage
          report, so a narrower scope is visible rather than silent.
        </p>
        {SCOPE_FLAGS.filter((flag) => !flag.widens).map((flag) => (
          <Checkbox
            key={flag.key}
            label={flag.label}
            checked={draft.scope[flag.key]}
            onChange={(_event, data) =>
              patch({ scope: { ...draft.scope, [flag.key]: data.checked === true } })
            }
          />
        ))}
        <h4>Always included</h4>
        {SCOPE_FLAGS.filter((flag) => flag.widens).map((flag) => (
          <Checkbox
            key={flag.key}
            label={flag.label}
            checked={draft.scope[flag.key]}
            onChange={(_event, data) =>
              patch({ scope: { ...draft.scope, [flag.key]: data.checked === true } })
            }
          />
        ))}
        <h4>Must be checked before Apply</h4>
        <p className="tf-sub">
          A required scope that the host cannot read — or that a scan did not examine — refuses
          Apply and names the reason. Everything else is a limitation the coverage report states and
          moves past. Body text is always required; it cannot be turned off here.
        </p>
        {MANDATORY_SCOPE_FLAGS.map((entry) => {
          const inScope = scopeIsIncluded(draft.scope, entry.scope);
          const checked = draft.scope.mandatoryScopes.includes(entry.scope);
          return (
            <Checkbox
              key={entry.scope}
              label={entry.label}
              title={
                inScope
                  ? "Refuse Apply when this scope cannot be read or was not examined."
                  : "This category is not in the analysis scope, so it can never be examined."
              }
              disabled={!inScope}
              checked={checked}
              onChange={(_event, data) =>
                patch({
                  scope: {
                    ...draft.scope,
                    mandatoryScopes:
                      data.checked === true
                        ? [...draft.scope.mandatoryScopes, entry.scope]
                        : draft.scope.mandatoryScopes.filter((scope) => scope !== entry.scope),
                  },
                })
              }
            />
          );
        })}
      </section>

      {problem !== null && <MessageBar intent="warning">{problem}</MessageBar>}
      {error !== null && (
        <MessageBar intent="error" role="alert">
          {error}
        </MessageBar>
      )}
      {savedAt !== null && (
        <MessageBar intent="success" role="status">
          {savedAt}
        </MessageBar>
      )}
      <div className="tf-settings-actions">
        <Button appearance="primary" onClick={save} disabled={!dirty || problem !== null}>
          Save governance policy
        </Button>
        <Button
          onClick={() => {
            setDraft(toDraft(policy));
            setError(null);
            setPendingProtection(null);
          }}
          disabled={!dirty}
        >
          Discard changes
        </Button>
      </div>
    </section>
  );
}

/** Re-exported so a test can build a draft without rendering the whole form. */
export type { PolicyDraft };
export { PROTECTION_FLAGS, SCOPE_FLAGS };
