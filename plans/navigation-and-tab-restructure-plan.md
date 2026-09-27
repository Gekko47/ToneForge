# ToneForge — Tab Restructure, Semantic Review, and Consistency Tab

**Status:** ready to implement. All open design questions answered.

**Reverses ADR-0055** (one AI surface) deliberately. Restores capability the previous cleanup
removed, and adds a semantic rewrite engine that does not currently exist.

---

## 1. Locked decisions

These came from the product owner and are settled. Everything below follows from them.

| # | Decision |
|---|---|
| **D1** | The context menu is `ToneForge → Semantic Review`. **One static item.** It runs against the **currently active saved semantic profile** — no profile list in the menu. |
| **D2** | The navigation guard is restored. It serializes host navigation and **aborts an in-flight jump when the user selects the next finding**, so arrowing through findings cannot flood the host. |
| **D3** | **Auto-scan** (default **on**) and **auto-preview** (always on, not toggleable) both operate on **full-document deterministic scans**. A Settings toggle turns auto-scan off and leaves scanning to the manual **Re-scan Now** button. |

### D1 in practice — why there is no profile submenu

Office.js context-menu controls are declared **statically in the manifest** and there is no API to
populate them from saved state. A submenu listing saved profiles would be frozen at install time and
would show placeholder labels. The menu therefore carries one item, and the *active* profile — which
the user picks in normal use — is what the review runs against. If no semantic profile is saved and
active, the action reports that plainly rather than silently doing nothing.

### D3 in practice — the two scan modes

| Mode | Trigger | What runs | Preview |
|---|---|---|---|
| **Auto** (default) | Debounced document change | Full deterministic scan | Built automatically |
| **Manual** (auto-scan off) | Re-scan Now only | Full deterministic scan | Built automatically |

Incremental narrowing (§10) still runs under the hood as a **display optimisation** — it updates
the findings list faster. It never produces an appliable plan. Preview is always built from a full
scan, because coverage gates Apply and a narrowed scan has incomplete coverage.

---

## 2. What exists today vs what is new

This matters for sizing. A lot of the work is relocation, not construction.

| Capability | Status |
|---|---|
| C1–C10 consistency engine (10 checkers, adjudication, coverage) | **Built and wired.** `runConsistencyReview`, `src/analysis/consistency/checks/` |
| `resolveAnchor()` — semantic target-span resolution with 3 refusals | **Built** (item 4.3) |
| Learn Style with semantic measurement | **Built**, lives on the wrong tab |
| Per-finding navigation to text | **Built** (`navigateToFinding`), manually triggered |
| Tracked apply path | **Built**, single mutation path, gated |
| **Semantic rewrite engine** | **Does not exist.** `rewrite()` in `withSemanticHelpers` is a no-op alias for `complete()` — it builds no prompt. The prompt builder was deleted in `8338d51`. |
| **Two profile namespaces** | **Does not exist.** One profile holds all four blocks. |
| **Context menu** | **Does not exist.** |
| **Navigation guard** | Deleted in `8338d51`; restoring. |

---

## 3. Phase 1 — Navigation guard and ignore list

### 3.1 The guard (`src/word/navigationGuard.ts`)

Pure, host-free, unit-testable. Extends the deleted original with the abort behaviour from D2.

```ts
export interface NavigationOutcome {
  requestId: string;
  ok: boolean;
  /** "moved" | "stale" | "aborted" | "alreadyAtTarget" | error text */
  message: string;
}

export function createNavigationGuard(options: {
  navigate: (request: NavigationRequest, signal: AbortSignal) => Promise<NavigationOutcome>;
  onOutcome?: (outcome: NavigationOutcome) => void;
}): NavigationGuard;
```

Rules, each with a test:

| Rule | Behaviour |
|---|---|
| Serialize | One host navigation at a time. A request arriving while one is in flight is **aborted**, not queued. |
| Abort on supersede | Selecting a new finding aborts the in-flight `AbortController`. The superseded request resolves `{ ok: false, message: "aborted" }`. |
| Coalesce | Re-selecting the finding already shown returns `{ ok: false, message: "alreadyAtTarget" }` and never calls the host. |
| Stale id | A repeated `requestId` returns `{ ok: false, message: "stale" }`. |
| Failure is retryable | A *failed* outcome does **not** mark the id accepted, so a retry under the same id is allowed. |
| Rapid arrow-through | Ten selections in 200ms produce **one** host call, for the final selection. |

The last rule is the one that stops the flooding. Implemented by aborting the previous controller
on every new request, so only the newest survives.

Wired into `FindingCard`'s selection effect (§6.3) and the Consistency tab (§9.2).

### 3.2 Ignored findings become persistent

The spec puts ignored findings in a list at the bottom of the page, so they must survive a rescan
and a pane reload. Today they are component state plus a fingerprint set in storage.

- `PersistedState.ignoredFindings`: `IgnoredFindingSchema[]` = `{ fingerprint, findingId, category,
  message, range, nodeIds, ignoredAt }[]`.
- Keyed by **fingerprint** (category + normalised range), so a re-detected finding stays ignored.
- `ignoreFinding(id)` / `restoreFinding(fingerprint)` in the store.
- Ignored findings are filtered out of the open list and the open counts.
- Unknown fingerprints (a rule no longer fires) are pruned on load and reported, not silently kept.

---

## 4. Phase 2 — Data model

Everything in Phases 3–7 depends on this. Do it first.

### 4.1 Two profile namespaces

| | Deterministic Style Profile | Semantic Style Profile |
|---|---|---|
| Owns | `typography`, `houseStyle`, `measured` | `semantic` |
| Used by | the continuous whole-document scan | Learn Style, paragraph rewrite, deviations |
| Revisions | own draft/published trail | own draft/published trail |
| Active id | `activeProfileId` | `activeSemanticProfileId` (new) |

- `StyleProfileSchema` gains `kind: z.enum(["deterministic","semantic"]).default("deterministic")`.
- **A second map** `semanticProfileRecords` in state. Not a composite `${kind}:${uuid}` key — that
  would break `z.string().uuid()` and every existing selector.
- `selectActiveProfile(state, kind)` gains a kind argument.
- `createProfileRecord(name, now, seed, kind)`.

### 4.2 Migration v10 → v11

One migration, covering the profile split **and** the new `autoScan` setting:

1. Every existing record becomes `kind: "deterministic"`.
2. Each record's `semantic` block is **copied** into a new semantic record with its own draft. A
   user who has learned a style keeps it; nothing is discarded silently.
3. `settings.autoScan = true` for every existing user (the documented default).
4. `STORAGE_KEY` → `ToneForge.State.v11`; `v10` added to `LEGACY_STORAGE_KEYS`.

Round-trip tests: v10 → v11 → re-migrate is stable; a v10 record with a populated `semantic` block
lands in both namespaces; a v10 record with an empty one produces no empty semantic record.

### 4.3 Publishing does not advance the revision

Spec: "the revision must stay the same, the draft must just become published."

- `publishDraft()` promotes the draft in place and appends a `published` action to the trail.
- The numeric revision is **unchanged**.
- The next **edit** after publishing starts the next revision.

Test: draft at r4 → publish → still r4, now published → edit → r5.

### 4.4 Auto-scan setting

- `settings.autoScan: z.boolean().default(true)`.
- Read by the observer. When `false`, `startObserver()` does not subscribe; **Re-scan Now** runs a
  full scan on demand.
- The toggle lives in Settings → Document. Auto-preview is **not** toggleable and is not a setting.

---

## 5. Phase 3 — Document Governance tab

Target order, top to bottom:

```
Profile line   [Deterministic profile] [r7] ............ Last scan 10:42:03
─────────────────────────────────────────────────────────────────────
Findings       Mandatory: 3 open findings · Advisory: 11 open findings
               [‹ Previous] [Next ›]     [Apply All]     [Re-scan Now]
               ┌ finding card ────────────────────────────────┐
               │ category · severity · risk                   │
               │ message / actual / expected                  │
               │ [Go to text]   [Apply]   [Ignore]           │
               └──────────────────────────────────────────────┘
Coverage warnings            ← own section, own styling
Ignored findings (3)         ← Restore per row
Pending changes              ← bottom of page
```

| # | Item | Where |
|---|---|---|
| 5.1 | Reorder; `PendingChanges` last | `Dashboard.tsx` |
| 5.2 | Header: deterministic revision right of the name; `Last scan` far right, same line | `TaskPaneHeader.tsx`, `taskpane.css` |
| 5.3 | **Auto-navigate on selection** via the guard | `FindingCard.tsx` |
| 5.4 | Per-finding **Apply** before **Ignore**; remove Review | `FindingCard.tsx` |
| 5.5 | Ignored list with Restore | new `IgnoredFindings.tsx` |
| 5.6 | `summarizeOpenFindings()` → "Mandatory: X / Advisory: X" | new `findingSummary.ts` |
| 5.7 | `CoverageBanner` out of `GovernanceDashboard` into its own section | split `GovernanceDashboard.tsx` |
| 5.8 | **Auto-preview** on every full scan; no button | `Dashboard.tsx` scan effect |
| 5.9 | **Apply All** below prev/next; **Re-scan Now** to its right, removed from `GovernanceDashboard` | `Dashboard.tsx` |
| 5.10 | Remove the Safe Reformat section | `ReformatPanel` |

**Severity mapping** for the counts: `error → mandatory`, `warning → advisory`, `info → informational`.
Counts exclude ignored findings.

### 5.11 Per-finding Apply — the honest constraint

A single change still takes the full path: `planChanges` → `validatePlanBeforeApply` →
`applyChangePlanWithTracking` (tracked, gated on `STAGE_01_PASSED`, refuses on `docHash` mismatch).
It **cannot** bypass `revisionAdapter`. Implementation builds a one-change `ChangePlan` from the
finding and applies it. If the document moved since the scan, it refuses with the stale reason and
says so — that refusal is correct behaviour, not a defect.

### 5.12 Removing Safe Reformat

The section goes. The **tracked-editing preparation control** moves to Settings → Document: it is a
host capability toggle, not a findings feature, and removing it would strand `STAGE_01_PASSED`.

---

## 6. Phase 4 — Deterministic Style Profile tab

Renamed from "Style profile".

| # | Item |
|---|---|
| 6.1 | Remove all `semantic` fields from `ProfileEditor`: tone, voice, formality, readingGradeTarget, preferredSentenceLength, vocabularyRegister, rhetoricalStyle, avoidWords. They move to the Semantic tab. |
| 6.2 | Save writes only `typography`, `houseStyle`, `measured` into a `kind: "deterministic"` record. |
| 6.3 | **Show all revisions** toggles `ProfileRecordSection` + `VersionDiff`. Default collapsed. |
| 6.4 | Publish-in-place (§4.3). |
| 6.5 | **Move `GovernancePolicySection` off this tab** → Phase 5. |
| 6.6 | Move **Learn Style** off this tab → Phase 6. |

After this phase the tab holds only deterministic concerns, which is the point.

---

## 7. Phase 5 — Governance Policy tab (new)

| # | Item |
|---|---|
| 7.1 | New destination `governance-policy`: `TaskPaneDestination`, `TaskPaneTarget`, `TARGETS`, `DESTINATIONS`, `commandHandlers.openGovernancePolicy`. |
| 7.2 | `GovernancePolicySection` moves here unchanged. |
| 7.3 | Lead paragraph: this governs **all three engines** — deterministic review, semantic review, consistency check. Protection and analysis scope live here and nowhere else. |
| 7.4 | Manifest: `ToneForgeGovernancePolicyControl` + `ToneForgeGovernancePolicy` action, in **both** `manifest.json` (v1.30) and `manifest.xml`. `npm run validate` checks both. |

---

## 8. Phase 6 — Semantic Style Review tab

Replaces "AI Review". Everything here is about semantic style.

### 8.1 Learn Style (moved from Profile)

- Accepts a **pasted source text** box as well as "capture the current selection". `captureSample`
  already takes text, so this is a source picker.
- On completion, writes to a **`kind: "semantic"`** draft record — not a new deterministic record.
- "Finalised later": the draft persists against the sample until the user saves or edits it.

### 8.2 Measured style + semantic style sections

- **Measured style** — read-only. It is measured, not authored.
- **Semantic style** — editable, and this is what the rewrite consumes.
- Both read and write the **semantic** record.

### 8.3 The rewrite engine (new code)

```
src/ai/prompts/rewritePrompts.ts
    buildRewritePrompt(text, semanticStyle, measuredStyle, opts)
      throws unless opts.includeRawText === true
    RewriteResponseSchema  { original, revised, rationale, confidence }

src/analysis/rewriteEngine.ts
    proposeRevision(selection, style, registry, signal)
      -> prompt -> Zod parse -> resolveAnchor() -> Finding[] + Change[]
```

- `resolveAnchor()` (item 4.3) supplies the three refusals: the model did not quote the text, the
  quoted text appears more than once, the node has no document offset. Each produces an advisory
  finding that says why, never a speculative change.
- Reuse `withRetry`, `AbortSignal`, and the planner's `semanticChanges` branch, which now prefers
  `finding.expected` over prose parsing (ADR-0064).
- Never sends text without `includeRawText: true` **and** `semanticOptIn`.

Flow: selection → prompt → Zod → anchor → **preview in this tab** → Apply → tracked `replaceText`
through the single mutation path.

### 8.4 Pending changes on this tab

Semantic findings only. Filter the plan by `source === "ai" || source === "profile"`, and state the
count. Deterministic changes must not appear here.

---

## 9. Phase 7 — Consistency Review tab (new)

The engine already exists. This is **relocation**.

| # | Item |
|---|---|
| 9.1 | New destination `consistency`. `AiReviewSection` moves here verbatim, renamed `ConsistencyReviewSection`. |
| 9.2 | Button reads **"Check Consistency"**. Results adopt the Governance findings format: prev/next stepping, Go to text, auto-navigate through the guard. |
| 9.3 | **Group similar inconsistencies.** `toFindings` emits one finding per issue; group by `checkId` plus a normalised evidence pair, so "the same figure given two values — 6 places" is one card listing 6 locations. Each location jumps to its own span. |
| 9.4 | A finding with no resolvable `sourceRange` prints **"cannot be located"** rather than offering a jump that will fail. |
| 9.5 | `consistencyReviewConsent` and its own wording stay exactly as they are (ADR-0052). Adding a surface must not relax a consent. |

---

## 10. Incremental scanning under the new model

Phase 4.2 made scans incremental. That stays, as a **display optimisation only**.

| Condition | Behaviour |
|---|---|
| Auto-scan on, full rescan | Findings + **preview** |
| Auto-scan on, narrowed local edit | Findings updated fast; **preview withheld**, message: "Re-scan to preview" |
| Auto-scan off | Nothing until **Re-scan Now**, which is a full scan and produces a preview |

The five conservative full-rescan fallbacks from item 4.2 are unchanged, as is the refusal to
retain findings across runs (ADR-0063). Recorded as ADR-0067.

---

## 11. Phase 8 — Context menu (D1)

| # | Item |
|---|---|
| 11.1 | `manifest.json`: `ExtensionPoint` → `OfficeMenu` `id: "ContextMenuText"` → `Menu` **"ToneForge"** → one `Button` **"Semantic Review"**, `ShowTaskpane`. Mirror in `manifest.xml`. |
| 11.2 | New nav instruction `semantic-style` with `action: "review"`. |
| 11.3 | The pane reads the **live selection itself** via `runInWord` and runs the review against `activeSemanticProfileId`. |
| 11.4 | No active semantic profile → the action says so and offers the Semantic tab. It must not silently do nothing. |
| 11.5 | Fix the `supportsContextMenu` probe: it tests the `Office.contextMenus` (ContextMenuApi 1.1) namespace, which is a **different feature** from manifest-declared menu support. |
| 11.6 | Ribbon fallback **"Semantic Style"** for contexts where the menu does not appear. |
| 11.7 | Record host requirements in `docs/manual-verification.md`. |

### 11.8 Selection must not travel through storage

The command runtime and the pane runtime are different JavaScript contexts. The command therefore
writes **only a nav instruction and a nonce** — never document text. The pane reads the live
selection from Word itself. Putting text in `localStorage` to bridge the two would leak document
text into persistent browser storage and break the privacy posture in `docs/privacy-security.md`.

### 11.9 One honest limitation

`ContextMenuText` appears when the user right-clicks **selected text**, not a bare paragraph
cursor. The in-product text and the manual verification step both say "select the paragraph's
text, then right-click". This is a host constraint, recorded in ADR-0068.

---

## 12. Phase 9 — Settings, OAuth, Troubleshooting

### 12.1 Settings

Already correct. Two changes: the relocated tracked-editing control (§5.12) and the **auto-scan**
toggle (§4.4).

### 12.2 OAuth — what you must do

The state machine is **complete and tested**. `ANTHROPIC_OAUTH_ENABLED` defaults to `false`, so
Anthropic and OpenAI show "Unavailable in this build". To enable:

1. **Register an OAuth app** with the provider. Anthropic: Console → OAuth. OpenAI: official
   registration is required — a ChatGPT subscription login is not an OAuth app and must never be
   relabelled as one.
2. **Run a gateway** on your own infrastructure, exposing:
   - `GET /oauth/authorize` — redirect to the provider with a **single-use** `state` + `nonce`; the
     gateway retains the PKCE verifier.
   - `POST /oauth/callback` — validate `state`, `nonce`, and origin; exchange the code using the
     client secret; store the refresh token; return an **opaque connection id**.
   - `GET /models` on the same origin.
3. **Set build-time env** (never in the repo): `ANTHROPIC_OAUTH_ENABLED=true`,
   `LLM_BROKER_URL=https://your-gateway`. The client secret lives **only** on the gateway.
4. **Set the redirect origin** in the provider app to the gateway's origin.
5. **Reinstall the add-in** — env is baked at build time.
6. The gateway must never return a token to the browser. The add-in holds only a connection id.

The browser half is already correct: origin check, single-use `state`/`nonce`, 10-minute TTL, no
PKCE verifier in the bundle. **Do not "finish" this in the browser** — that inverts the security
model.

### 12.3 Troubleshooting

Three new sections, each sourced from a real failure the new wiring can produce:

- **Semantic rewrite did not run** — no provider, `semanticOptIn` off, empty selection, or the
  anchor could not be resolved (three named reasons from `resolveAnchor`).
- **Consistency review is partial** — windowing, cross-window pairs skipped, adjudication cap hit.
  All three already appear in `coverage.limitations`; surface them verbatim.
- **Context menu item missing** — needs a build with `AddinCommands 1.1` and *selected text*;
  ribbon fallback available.

---

## 13. ADRs

| ADR | Subject |
|---|---|
| 0065 | **Reverses ADR-0055** — three review surfaces are correct; one-surface removed required capability. |
| 0066 | Deterministic and semantic profiles are separate records with separate revisions. |
| 0067 | Auto-preview is full-scan only; auto-scan is toggleable. |
| 0068 | Context menu is one static item using the active profile; requires selected text. |
| 0069 | Auto-navigate on selection makes the navigation guard a correctness requirement. |
| 0070 | OAuth stays flag-off until a gateway exists (status update on ADR-0060). |

---

## 14. Build order

Each phase is independently shippable and each ends green on `npm run verify`.

| Phase | Scope | Exit gate |
|---|---|---|
| **P1** | Navigation guard, ignore list | Guard unit-tested; ignored findings survive rescan |
| **P2** | Data model, migration v11, publish-in-place, auto-scan | Migration round-trip tests |
| **P3** | Document Governance | Auto-preview, per-finding apply, counts, ordering |
| **P4** | Deterministic Style Profile | Semantic fields gone; revisions collapsible |
| **P5** | Governance Policy tab + manifest | `npm run validate` green on both manifests |
| **P6** | Semantic Style Review + rewrite engine | Engine tested offline via `MockAdapter` |
| **P7** | Consistency tab | Relocation only; existing engine tests unchanged |
| **P8** | Context menu | Host-gated manual evidence recorded |
| **P9** | Settings, OAuth docs, troubleshooting, ADRs, CHANGELOG, project-state | Full `npm run verify` |

---

## 15. Invariants that hold throughout

- `applyChangePlan` remains the **only** Word mutation path (ADR-0005). Per-finding apply, the
  rewrite apply, and the context-menu action all go through it.
- Deterministic engines never call the LLM.
- No prompt sends raw text without `includeRawText: true` **and** explicit consent.
- `consistencyReviewConsent` is never satisfied by any other permission.
- Every new surface states provider, scope, and what a model may get wrong **before** the click.
- All unit tests stay offline via `MockAdapter`.
- Docs updated per phase: `project-state.md`, `CHANGELOG.md`, `manual-verification.md`. New open
  gates are recorded, not papered over.
