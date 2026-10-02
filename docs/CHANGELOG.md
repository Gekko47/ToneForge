# ToneForge — Changelog

## Unreleased — Semantic review (2026-10-02)

Repository-complete; **host-unverified**. `npm run verify` is green across all
thirteen stages and 2 350 tests. Per ADR-0051 that is not a release claim, and
`npm run release:check` stays blocked. The named host procedures are in
[`manual-verification.md`](manual-verification.md).

- **The one "Semantic" tab is two pages.** `semantic-review` and
  `semantic-style`, from one ribbon command relabelled "Semantic Review". Learning a
  style sends a sample once and is then local; a review sends the user's own
  paragraph on every press. Behind one heading the second looked like the first. A
  second ribbon button would have needed a second command claiming a navigation
  target, and `duplicateNavigationTargets()` fails the build on exactly that. See
  D10, ADR-0096.
- **The manifest supertip no longer points at the wrong page.** It said "Nothing is
  changed until you approve it on Deterministic Review", which has been false since
  ADR-0078 gave the semantic apply its own path. Both manifests are edited together,
  because a control in one and not the other passes every check and ships a Word that
  has never heard of it.
- **The selection is read at the size of the selection.** The capture reads the
  selection, its offsets and its anchor, and nothing else — no whole-document read
  and no document hash, so a review of one paragraph does not cost a scan of the
  document. Whether a Word host fires a selection-change event is recorded as an
  **open question with a named procedure** (ADR-0094), not as a limitation: absence
  from our own type declarations is not absence from the API.
- **Two guards on the sole mutation path were failing open.** The protection and
  preservation checks read `Finding` fields reached through `change.findingId`, so a
  change with no finding skipped both — and a semantic revision has no finding by
  design. The checks now read the `Change` itself. Separately,
  `validateChangePreconditions` demanded a node precondition _and_ a text
  precondition for the same paragraph-unit write, which made that shape unplannable;
  the paragraph unit is the only text write available on every Word host. See
  ADR-0095, ADR-0097.
- **Learning produces a draft.** "Make this active" is a second, explicit press, and
  the page says an unactivated draft is not steering any review. The evidence is
  recorded as the style is learned rather than when it is activated, and it is
  metadata only: source, size, date and a hash. The sample is never stored. See
  ADR-0098.
- **A sample of 60 words is learnable but not confident, and says so.** Eligibility
  (40 words) and confidence (100/300/1000) are two axes; only eligibility blocks. The
  level is a persistent badge, not a transient warning, and the bands are exported so
  the badge, the gate and the tests cannot quote different numbers. See ADR-0099.
- **`.txt` import, refused for the right reason.** A `.docx` is a zip archive, and
  reading one as text would send the file's internal structure to a provider as
  though it were the user's writing. The validation is a DOM-free module; the
  component owns the `File` read.
- **A learned profile has publish, activate and recall controls for the first time.**
  `ProfileRecordSection` was wired only on the deterministic Profile page, so a
  learned profile had an audit trail nothing could reach.
- **The measured metrics are still all eight, and are now behind "Sample
  diagnostics".** The specification proposed deleting them; ADR-0076 had decided
  otherwise and a live test pinned it. They are relabelled, marked as derived, and
  collapsed — not removed. See D9.
- **Three new refusals can now be explained.** A selection over the cap, a revision
  the local check protected, and a host that cannot write part of a paragraph each
  get a Troubleshooting note with a named remedy. The last needed a new capability
  probe, `supportsRangedReplacement`, because the refusal could not be explained
  from a probe that never ran — which is the same defect ADR-0069 records for the
  context menu.
- **The rewrite engine, the rewrite prompts and the merged page are gone.** Nothing
  reached them since ADR-0055 retired the surface, and leaving them was a second
  contract through the merge point that skipped its checks.
- **`semanticRewrite` is two capabilities.** Learning needs a provider but not the
  profile it produces; review needs both. The old single capability required only a
  profile, which is how a button could be enabled with no provider to ask.
- **The scope card reads "Reviewing…", not a second control's state.** Every
  enabled/disabled decision on both pages comes from one pure gate module, so a
  button and the sentence beside it cannot disagree, and each refusal names the
  control that resolves it (→ to Troubleshooting's registry, ADR-0069).

## Unreleased — Deterministic review pass (2026-10-01)

Repository-complete; **host-unverified**. The structural scopes below were written
against Microsoft's published API reference rather than against a Word host, and
`npm run host:matrix` still reports 0 fully passing. See
[`manual-verification.md`](manual-verification.md) for the named procedure.

- **Tables, sections, headers, footers and page setup are actually read now.**
  Acquisition loaded `body.tables` and `document.sections`, the load plan tracked
  both, and `buildFormatting` produced neither DTO — so the analyzer's table,
  header/footer and page-setup checks compared empty arrays, and the coverage
  report named all four scopes unsupported whether or not they had been read.
  Every structural object the scan reads is now a document node, so the coverage
  report can count what it read rather than reporting zero for a document full of
  tables. See ADR-0086.
- **The analysis scope can now stop a read.** `includeTables`, `includeSections`
  and `includeHeadersFooters` were read by nobody: the policy was never passed to
  the load plan, so every scan requested all three structural scopes whatever the
  governance author had switched off.
- **A document with no tables is no longer "Incomplete".** Compliance was gated on
  every requested scope being examined, so a document with no tables on a host that
  cannot read them refused Apply, with a blocker naming something the user cannot
  change. It is now gated on what the author marked mandatory — and every other
  gap is still stated, as a limitation with its own remedy. See ADR-0087.
- **The coverage banner says "Unknown" instead of guessing.** It read the shared
  coverage report, which answers "did acquisition read everything"; the question
  a reader has is "did the review examine everything". A body-only scan with a
  perfect acquisition read as "Complete" before.
- **Apply reports every change, and says what is still wrong.** A partly-applied
  plan under Track Changes is the case where per-change detail matters most, and
  the report stopped at the first failure. It now lists each change with its own
  outcome, counts them consistently, and re-scans the document so "remaining
  issues" is a fresh look rather than a subtraction from the pre-apply list. See
  ADR-0088.
- **The profile editor has an information architecture.** Four collapsible
  sections, each stating what it decides, and each marked in its header when this
  Word version cannot check it — a marked section is still editable, because the
  host may be replaced and the profile is the durable record of the standard. See
  ADR-0089.
- **A header with no font name no longer reports a font mismatch.** The DTO
  accepted `""` where it should have read "not read", and the header check
  compares anything that is not null. See ADR-0090.
- **The review header counts by kind as well as by severity.** Severity answers
  "how bad"; the group answers "where to start". A document with four hundred
  spacing findings and twenty structural ones cannot be triaged from the first
  number.
- **The table, list, header/footer and page-setup standards can be set at all.**
  All four were declared in the profile schema, read by the analyzer, and wired
  to registered rules — so the §11 audit reported every one of them as covered —
  while no control anywhere in the pane could set them. At runtime they sat at
  `supported: false`, and the analyzer returns nothing for an unset standard, so
  those checks could never fire regardless of what a user did. Each now has an
  editor and an explicit compare switch, and a section that is only partly
  readable says which standards went unchecked instead of claiming the whole
  section is dead. See ADR-0091.

## Unreleased — Found by using it in Word

Every item here came from a session of driving the add-in in a real Word
document, not from reading the code. The theme is that the automated suite was
green throughout: none of these were visible to it, because each one is a
statement the product makes that turned out to be untrue.

- **Apply is no longer permanently blocked on a list-item document.**
  `buildCoverage` defaulted to requiring a `paragraph`/`heading` node, so a
  document of nothing but list items reported itself incomplete forever, and an
  incomplete plan blocks Apply. The check read as "did we acquire governance
  scope" but was written as a necessity test, and its `body` alternative was
  satisfied by every document — so it could only ever produce a false alarm.
  Completeness is now a shape-independent discovery question. See ADR-0066.
- **Apply writes only what you reviewed.** Review marked a finding and changed
  nothing else; the plan handed to Apply was the whole auto-previewed plan. It
  is now filtered, the button says `Apply {n} reviewed changes`, and the
  "apply all" shortcut is removed — a shortcut around the review gate is the
  affordance the gate exists to prevent. See ADR-0065.
- **The semantic tab can hold a profile.** `selectKindRecordList`,
  `setActiveSemanticProfile`, `createSemanticProfileRecord`, and
  `removeSemanticProfile` all existed with no caller, so the tab could only
  display the one profile Learn Style had just made. There is now a picker, and
  "create empty" needs neither a sample nor a provider — without it the tab was
  unreachable for anyone whose document was too short to sample, and the one
  route in ran a model over their prose. See ADR-0068.
- **Consent no longer locks you out of your own words.** The semantic editor was
  disabled when semantic consent was missing, which disabled typing a tone into
  a local field — exactly the user who had declined. Consent governs sending
  text to a provider; it has nothing to say about a local field.
- **Typing a tone no longer writes five revisions.** Tone, voice, and rhetorical
  style saved on every keystroke, and each save mints a revision, so typing
  "formal" polluted the audit trail with five drafts. They commit on blur, like
  the numeric fields beside them.
- **The stale banner stopped flashing.** `scheduleScan` marked findings stale on
  the first change event, before the 300 ms debounce elapsed, so every keystroke
  produced a banner that vanished faster than it could be read. Staleness is
  now declared only when a refresh genuinely fails, and the debounce is 1200 ms.
  See ADR-0067.
- **The capability probe stopped answering `false` to everything.** It checked
  `Office.contextMenus` and `Office.ui.contextMenus`, neither of which exists;
  the runtime API is `Office.contextMenu.requestUpdate`. It had no test.
- **Every refusal now names the control that resolves it.** "What to check" was
  a private function inside the troubleshooting panel, so no other surface could
  reuse it and the panel could only help someone who had already found it. It is
  a pure registry now, and each remedy names the actual control by its on-screen
  label. See ADR-0069.
- **A manifest change needs a full Word restart, and this is documented.** The
  ribbon tab and context-menu entry were missing from a live Word after being
  added correctly to both manifests. They were not a provider problem. Word
  caches the manifest at registration, and `npm run sideload` reads
  `manifest.xml` — never the unified `manifest.json` — so a control added to one
  file passes every check in this repository. See ADR-0070.

## 0.4.0 — Honest capabilities

Every control now changes behaviour, and every surface says what it did not do.
The organising theme is that a setting which changes nothing is a defect, not a
placeholder.

- **The scan → preview → apply loop is reachable and honest.** Apply is enabled only
  when the host is ready, and its disabled reason is shown in place with a link to the
  setting that fixes it. The ribbon dropped from seven commands to six real ones, and
  "Scan Now" now actually scans rather than only navigating. Findings are a listbox
  with a real selection, and marking one reviewed persists across rescans instead of
  reverting. See ADR-0058, ADR-0061.
- **A host outage is not a stale document.** A Word runtime failure and a changed
  document are reported separately, so a user is no longer sent to re-scan a document
  that had not moved.
- **Retired code is gone.** The Stage 18 smoke-mutation path, the spot and
  full-document review engines and their orphaned task-pane components, the
  navigation controller, the OAuth state reducer, and the unreachable `useAnnouncement`
  are removed. Nothing referenced them. See ADR-0059.
- **The revisions CSV export works.** `toRevisionsCsv` was written and never called;
  it now has one call site, in `PendingChanges`, and refuses to export a plan whose
  coverage is incomplete.
- **Settings contains only controls that change behaviour.** The telemetry toggle
  gated a build-time env flag with no analytics endpoint; the two retired review
  consents gated engines that no longer exist. All three are removed in state
  **v10**, and a v9 user keeps their provider connection and their AI Review consent.
  `normalizeSettings` was spreading the stored object, which meant every key a user
  had ever stored rode through every migration untouched — it now rebuilds from an
  explicit field list, so a schema change actually takes effect. See ADR-0060.
- **Providers say whether this build can reach them.** Unavailable providers are
  marked with a reason and cannot be selected, rather than being offered and failing
  on connect.
- **One live region, with an explicit priority.** The observer, the apply path, and the
  review each rendered their own polite live region, so two could speak in the same
  tick and be read in DOM order rather than event order. The pane now has one, fed by a
  pure `deriveAnnouncement`. See ADR-0062.
- **Governance policy is authorable, versioned, and takes precedence.** `rules`,
  terminology, scope, protection, and editorial were modelled, given precedence by
  `resolveResolvedPolicy`, and written by nobody — permanently the schema defaults,
  while `ChangePlan` cited a `governancePolicyRevision` for a policy that could not
  differ from any other. A rule is now bound to a finding category and can withhold a
  change, raise its approval requirement, and be cited in Pending Changes. Protection
  flags are read by the apply-time check, and `userLockedRanges` holds node ids rather
  than UUIDs it could never match. See ADR-0061.
- **The consistency engine handles long documents.** Statements were truncated past the
  bound, so a contradiction in the second half of a long report did not exist. Every
  statement is now examined; what is bounded is the number of _pairs_ compared, and
  the exact count of comparisons that fell between windows is reported. See ADR-0052.
- **Scans examine only what changed, and say so.** The paragraph event payload was
  wired and discarded. It is now forwarded, and a local event with complete ids
  narrows the examined scope, with five cases forcing a conservative full rescan. No
  cross-run retention: growing one paragraph shifts every offset after it, so a
  retained finding can point at the wrong sentence while looking normal. See ADR-0063.
- **Semantic findings carry a verified span or none.** Each carried a whole-document
  range and `actionable: false`, so the planner could never produce a change from one.
  The model must now quote the text it is describing; a unique match yields a
  plannable finding with an exact precondition, and an absent, ambiguous, or
  unaddressable quote yields a stated refusal. See ADR-0064.

### Open gates

Two items are host-dependent and are recorded as procedures, not results, in
[`manual-verification.md`](manual-verification.md): the incremental scan scope (ADR-0063)
and live accessibility evidence. Neither is claimed as verified.

## 0.3.0 — Task-pane UX and host-compatibility remediation

- **AI Review is one surface running one engine.** The page presents a single
  cross-report consistency review with one disclosure, one consent-gated action, and
  one prerequisite hint. The three `ai-review-*` navigation targets collapse to
  `ai-review`, and navigation no longer auto-starts a review. The spot and
  full-document engines, their persisted consents, and their tests are unchanged; only
  their task-pane entry points are retired. See ADR-0055.
- **The missing-consent message is stated once.** It was previously rendered three
  times, once per disabled control, because each control carried its own copy of the
  same sentence.
- **Settings shows one AI Review consent.** The `spotReviewConsent` and
  `fullDocumentReviewConsent` toggles are no longer rendered. Both fields remain in
  the state schema and migrations, so existing state loads unchanged and no state
  version bump is required.
- **Analysis acquisition is capability-gated and degrades.** It previously loaded
  `document.styles` and per-paragraph formatting regardless of what the probe found,
  and live Desktop Word rejected the whole request with a generic
  `GeneralException` — losing every scan. Optional properties are now requested only
  when the probe found them, skipped properties are named in the coverage report, and
  a host rejection retries once with a text-only scope. See ADR-0056.
- **Host errors are diagnosable again.** A blanket `/error/i` redaction rule replaced
  every failure with `[REDACTED_CONTENT]`. `errorName`, `errorCode`, and `errorMessage`
  are now allowlisted for diagnostics, still credential-redacted and length-capped.
- **Dark mode applies to controls and the page canvas.** Fluent themes are now
  inverted, which is the field that makes Fluent paint its own components dark; the
  theme class is applied to the document element so `html` and `body` resolve the CSS
  custom properties, removing the white frame around the content card. See ADR-0057.
- **The header reports the page that is actually open.** The main render passed a
  literal `"home"`, so "Document Governance" stayed highlighted on every page.
- **Profile revisions can be recalled.** `recallRevisionAsDraft()` clones any audited
  revision into a new draft, and every audit-trail entry now has a Recall action. A
  profile that has never been published previously had no way back at all. Recall
  creates a draft only; publishing stays an explicit second step, so "documents are
  checked against the active published revision" still holds.
- **Model selection is a provider-supplied list.** The model field is a searchable
  combo box populated from the gateway's catalog for any connected provider, with a
  refresh action and a manual-entry fallback, rather than free text only on OpenRouter.
- **Tracked editing moved to Settings and can be armed.** The enable path never
  persisted the flag before probing, so the preparation read `false` back, refused,
  and the toggle snapped straight off. It now persists first, and the control lives in
  Settings where Troubleshooting only reports its state.

## 0.2.0 — Refactor candidate (unreleased)

- Added additive domain contracts for structured document nodes, governance
  profiles, review requests, and enriched findings/changes/plans.
- Phase 0 adds a first-run profile setup state, conservative observer-rescan
  finding retention, scope-qualified coverage semantics, stable versioned
  ignored-finding fingerprints, user-visible navigation feedback, and safe
  clearing of blank optional broker settings.
- Phase 0 makes ReformatPanel preview-only and leaves one reviewed-plan
  Apply/Reject workflow in Pending Changes; technical coverage diagnostics are
  isolated to Troubleshooting.
- Phase 1 adds `ResolvedPolicy` so learned style evidence and normative governance
  are resolved once for analysis and planning, and always capture a policy
  revision for safe apply.
- Phase 1 adds the Learn Style service and Profile entry point: selection/document
  capture, sample-quality gating, deterministic evidence, optional consented
  semantic interpretation, and an editable persisted draft.
- Phase 2 adds capability evidence tiers, a WordApi 1.6 paragraph
  added/changed/deleted event adapter with deregistration and conservative
  fallback, and the B23 workflow projection store with task-first status and
  finding previous/next navigation.
- Added state schema v5 with v0-v4 fallback migration, initial governance-profile
  seeding, governance-history snapshots, and current-policy revision enforcement.
- Added single-pass Word paragraph/style acquisition, explicit structural
  coverage diagnostics, protection, rule registry, source navigation, and a
  debounced observer with conservative full-rescan fallback.
- Added Word-native ribbon/task-pane governance surfaces, consent-gated spot
  review, bounded full-document review, UI states, and coverage-gated exports.
- Added safe-apply preservation/dependency/protection checks, post-apply hash
  verification, command-action registration, absolute AI ranges, bounded review
  batches with freshness re-checks, release staging, and release gates.
- Phase 4 adds the provider-neutral connection contract. The add-in persists only
  an opaque connection reference; the live session token is held in memory for
  the pane's lifetime and `SessionTokenStore` has no serialization method at all.
  `ProviderConnectionSchema` has no field capable of holding a secret, and a test
  reflects over the schema to keep it that way.
- **Breaking:** the `apiKey` credential mode is removed. Every remote provider is
  routed through `GatewayRoutedAdapter`; OpenAI, Anthropic, and OpenRouter now
  share one connection contract and differ only in request/response shape.
- The gateway client accepts only a same-origin path or a loopback HTTP(S)
  origin, so no Settings field can name an arbitrary host. A production origin is
  build-time configuration.
- Added an OAuth state machine with single-use attempts and per-attempt state,
  nonce, origin, and expiry validation. OpenAI user OAuth is feature-gated rather
  than presented as generally available, because it is not.
- State schema v8 adds a provider-neutral `providerConnections` map and widens the
  persisted provider enum to all four providers. The v7 migration derives
  loopback-only connections, preserves every consent decision, and drops a
  connection filed under the wrong provider.
- Added a dynamic model catalog normalizer that prefers the _enforced_
  `top_provider` context limit over the advertised one, derives capability flags
  from `supported_parameters`, and distinguishes empty, stale, failed, and
  offline catalogs.
- Added OpenRouter as a provider option. The API key is held in component state
  only, submitted once to the local gateway over the existing loopback
  nonce-protected channel, and dropped when the request settles; the base URL is
  prefilled with `https://openrouter.ai/api/v1` and the model dropdown is
  populated from the provider's own model list.
- Automated verification now writes `build/verification/summary.json` on success
  **and** failure, classifying each stage as `repository-code`,
  `dependency-install`, `build-package`, or `external-evidence`. The human
  Word-host gate is recorded as always open and cannot be marked passed by a
  caller, so an all-green run is never reported as a release.
- Added `npm run host:matrix`, which generates a release dashboard from the host
  matrix. It maps an unrecorded cell to `unknown` rather than a pass, flags
  evidence older than 90 days, and reports 4 hosts with 0 fully passing.
- Added production manifest generation that refuses non-HTTPS, loopback,
  private-network, local-hostname, non-standard-port, development-broker, and
  credential-shaped origins. The checked-in manifest stays on localhost so
  `npm run sideload` is unaffected.
- Bundle sentinel builds now cover five credential shapes (OpenAI key, OAuth
  client secret, PKCE verifier, OpenRouter key, Anthropic key) and prove none of
  them reach either the development or production bundle.
- Fixed: a failed disconnect left a usable session credential in memory; the
  registry silently fell back to the offline mock even when given a valid
  connection; state migration accepted a connection filed under the wrong
  provider; and the verification summary would have accepted a caller-supplied
  pass for the human host gate.
- Phase 5 implements the cross-report consistency engine that the ROADMAP had
  reserved as Phase H. Per ADR-0052 it is a **separate** engine with its own
  pipeline, its own third consent, and its own opt-in — never the typing path,
  never the observer. This supersedes both the plan's Phase 5 instruction to
  "keep C1-C10 deterministic" and the ROADMAP's "Phase H reserved until
  release", on the release authority's direction.
- Added ten cross-report checks (C1-C10) over a whole-document snapshot:
  terminology drift, numeric contradiction, temporal conflict, entity attribute
  conflict, definitional conflict, unit inconsistency, status contradiction,
  reference conflict, section promise mismatch, and scope contradiction. Each
  narrows deterministically first; only the residue reaches the model.
- A candidate conflict is a distinct type from a finding. Only a deterministic
  resolution or a `contradiction` verdict promotes it, an unreadable model
  answer is `unclear` at confidence 0, and a run against a document that has
  since changed is discarded rather than reported.
- The engine reports its own coverage. Pairwise comparison is bounded at 400
  statements, the bound appears in the report as a limitation, and a partial
  result is labelled as such in both the panel and the summary line.
- `consistency` was added to `FindingKind`, so a consistency finding is planned,
  gated, and applied through exactly the same path as every other finding. It
  has no privileged route to the document.
- State schema v9 adds `settings.consistencyReviewConsent`, a fourth consent
  flag that is never inherited from the other three. The v8 migration sets it to
  `false` rather than deriving it, and all four consent flags are now re-derived
  from strict booleans on load, so a persisted `"yes"` reads as a refusal.
- Fixed: `compareDates` reported a month-only date as _the same date_ as a
  precise one in that month, a false negative that read as a decision; C4's
  proper-noun entity anchor was being discarded by the generic vocabulary
  threshold before it could run; C8 did not recognise `Smith (2019)`, the most
  common citation form, leaving it inert on most real text; C10 detected
  narrowing only through conjunctions and missed the negation that does the
  actual work in "however three are not yet"; and `normalizeSettings` spread raw
  persisted values over the defaults, so a stored non-boolean in a consent field
  would have read as permission.
- The ten checks are **unvalidated heuristics**. They have not been calibrated
  against a real corpus and will produce false positives on real prose. The
  engine has never been run against a real document or a real model; all
  evidence is unit tests and `MockAdapter`.
- Automated verification uses the shared `toneforge-repository-v1` graph for
  typecheck, lint, format, source/artifact secret scans, documentation links,
  skills validation, tests, 80% exercised-core coverage, build, manifest
  validation, staging, and coherent release-package checks. The current run
  passes 100 files / 1109 tests with 93.8% lines, 93.8% statements, 81.29%
  functions, and 82.95% branches.
- Phase 6 is HELD pending further testing. The dependency-upgrade decision
  recorded in `docs/privacy-security.md` is a prerequisite for resuming it.
- Phase 3 adds the organizational profile record: one editable draft, immutable
  published versions, explicit activation, restore-as-draft, and discard, plus
  an append-only revision audit trail that keeps the newest 20 revisions and
  never drops a published one.
- State schema version 7 makes that record the single source of truth. It
  replaces `profiles`, `profileHistory`, and `profileLifecycles` with one
  `profileRecords` map, so the previously duplicated views can no longer
  disagree. The v6 migration folds the edit trail and the approval trail into
  non-colliding revision numbers, so no approved state is discarded.
- Profile revisions are plain integers rather than semver, and every audit event
  — including publishing — consumes its own number. A `ChangePlan` now cites the
  exact revision it was built from, and restoring an old snapshot can no longer
  forge a revision because the record assigns the number on save.
- Phase 3 splits Settings into independently-saved Styling, Provider and
  privacy, and Telemetry sections over a pure settings model, so a failed save
  in one section cannot discard unsaved edits in another.
- Phase 3 adds side-by-side profile revision comparison with progressive
  disclosure of the technical diff, a reduced-noise announcement hook that
  collapses bursts into one live-region message, and narrow-width and
  reduced-motion styles.
- Hardened planning with complete document identity, unit-aware targets, change
  preconditions, source/approval lineage, exact AI source slices, fail-closed
  Apply readiness, and credential-free ordinary state.
- Kept `manifest.xml` as an explicit `ShowTaskpane` navigation fallback while
  `manifest.json` remains the execute-function manifest; parity validation checks
  their documented command identities, labels, and destinations rather than
  claiming equivalent action mechanisms.
- Hardened production bundling with a separate runtime chunk, vendor/common
  splitting, dependency cleanup, and a 600 KiB asset/initial-page budget enforced
  by `npm run build:check` without suppressing Webpack diagnostics.
- Release acceptance remains blocked by the external Word host matrix and
  live performance/accessibility/security/provider/production-custody evidence; see
  [`ROADMAP.md`](../ROADMAP.md) for canonical status.

## 0.1.0 — 2026-09-19 — Scaffold

- Repository baseline and production-ready scaffold.
- Unified JSON manifest v1.30 and XML fallback.
- Core domain model, state persistence, provider abstraction, Word boundary, and
  task-pane shell.
- TypeScript, Webpack, Vitest, ESLint, Prettier, Husky, commitlint, and CI.
- Architecture, onboarding, privacy, accessibility, project-state, and decision
  records.
