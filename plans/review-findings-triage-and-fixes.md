# Review findings — triage and minimal fix plan

Scope: the 19 review comments supplied against ToneForge. Each was verified
against the current working tree before any fix was proposed. Fixes are kept
minimal and must not change existing behaviour beyond the stated defect.

Validation gate for the whole change (see `.roo/rules/zoo-rules-build-manifest.md`):
`npm run typecheck` → `npm run lint` → `npm run format` → `npm run test`
(plus the targeted suites listed below) and, before commit, `npm run verify`.
The Word-host gate stays human/pending — a green automated run is not a release.

## Triage summary

| #   | Location                                                   | Verdict                 | Note                                                                                |
| --- | ---------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| 1   | `ROADMAP.md:1`                                             | Fix                     | Mojibake throughout the file, not just the heading                                  |
| 2   | `docs/manual-verification.md:937-987`                      | Fix                     | Doc contradicts the mock-only `llm-smoke.mjs` header                                |
| 3   | `plans/capability-ux-audit-and-implementation-plan.md:461` | Fix                     | Plan still retires the now-load-bearing `SettingsDashboard.tsx`                     |
| 4   | `plans/stages-07-11-plan.md:18`                            | Fix                     | Link label/target mismatch for `SettingsDashboard.tsx`                              |
| 5   | `DecisionPlanCompiler.ts` / `indexedEngine.ts`             | Fix (approach deviates) | Parameterless context requests; fix placed in the retrieval layer, not the compiler |
| 6   | `SystemOneResponseMapper.ts:20-27`                         | Fix                     | One bad item discards the whole answer array                                        |
| 7   | `indexedEngine.ts:789-795`                                 | Fix                     | `decisionModel` provenance claims a model that never ran                            |
| 8   | `indexedEngine.ts:594-599`                                 | Fix                     | `decisionParseFailed` ignores a successful rerun                                    |
| 9   | `DebuggingPanel.tsx:91`                                    | Fix                     | Uses the legacy provider check, not the role check                                  |
| 10  | `checks.ts:406-438`                                        | Fix                     | Parse-failed runs still trigger the two unbound-role notes                          |
| 11  | `LlmRole.ts:137-145`                                       | Fix                     | Reflection test does not unwrap optional/default/nullable                           |
| 12  | `RoleConnectionCard.tsx:52-59`                             | Partial                 | Fix the stale-binding case; skip the no-binding case (no place to persist the flag) |
| 13  | `SettingsDashboard.tsx:65-72`                              | Fix                     | Disconnect deletes a possibly shared connection and leaves the binding              |
| 14  | `SettingsDashboard.tsx:74-90`                              | Fix                     | Connect can overwrite the just-persisted connection                                 |
| 15  | `dev-gateway.mjs:303-374`                                  | Fix                     | `handleCallback`/`handleDeployment` skip the self-hosted approval gate              |
| 16  | `dev-gateway.mjs:290-336`                                  | Fix (dev-only)          | Authorize/callback not bound by an issued `state`                                   |
| 17  | `gatewayClient.ts:449-476`                                 | Fix                     | Connection probe retries on transient failure                                       |
| 18  | `SystemOneCompiler.ts:69-73`                               | Fix                     | Expanded context bypasses the redaction/evidence helper                             |
| 19  | `llmRoles.ts:41-49`                                        | Fix (by deletion)       | Dead duplicate of `providerComposition.isRoleConfigured`; delete it                 |

No finding was rejected outright. Two carry a documented deviation (5, 19) and
one is partial (12); reasons are in the per-finding notes.

## Per-finding fix specification

### 1 — ROADMAP.md mojibake

Replace every mojibake sequence with its intended punctuation, preserving all
surrounding wording and layout. Observed sequences and targets:

- `â€"` → `—` (em dash)
- `â€"` → `–` (en dash)
- `â†'` → `→` (right arrow)
- `Â§` → `§`
- `â€œ` / `â€` → `"` / `"` where a quote was intended
- `Â` → removed where it is a stray artifact

Bare `->` in plain code fences stays as-is (it is not mojibake).

### 2 — manual-verification.md smoke section

`scripts/llm-smoke.mjs` states the upstream is a **mock fetch**, that the harness
"does not prove a specific provider accepts a specific credential", and that the
real key/provider step is human. The doc at lines 937-987 claims the opposite
("It cannot prove that a real provider responds. The live smoke harness closes
that gap"; "the provider accepted the credential"). Rewrite the section so its
purpose and pass criteria describe only what the mock harness verifies (gateway
plumbing: connection issue, catalog, test, chat completion, disconnect), and
restate the credential/provider verification as a human step. Leave the script
header unchanged (it is the source of truth).

### 3 — capability-ux-audit plan

At ~line 461, the plan says to retire `TelemetrySettingsSection.tsx` **and**
`SettingsDashboard.tsx`. `SettingsDashboard.tsx` is now the load-bearing LLM
roles + privacy surface and must be retained. Amend to retire only
`TelemetrySettingsSection` (and its import/section), keeping `SettingsDashboard.tsx`
and its role-connection and privacy controls.

### 4 — stages-07-11 plan link

Line 18: the label `src/taskpane/components/SettingsDashboard.tsx` points at
`src/taskpane/App.tsx`. Retarget to
`../src/taskpane/components/SettingsDashboard.tsx:1`. Change only this link.

### 5 — context requests carry no parameters

Today `compileDecisionPlanWithCandidates` sets `requestedContext` to bare kinds,
and `indexedEngine` builds `{ type, candidateId, parameters: {} }`. The
parameter-needing expanders (`CTX-EVENT-HISTORY`→`eventId`,
`CTX-PROGRAMME-HISTORY`→`programmeId`, `CTX-TERM-DEFINITION`→`term`) therefore
always return "No … provided".

**Approach (deviates from the comment's "in the compiler" phrasing).** The plan
contract deliberately separates the _vocabulary_ (`DecisionQuestion.requestedContext`
kinds) from the _retrieval instruction_ (`ContextRequest` = kind + candidate +
parameters, owned by `contextExpansion.ts`). Put the resolution in the retrieval
layer to respect that boundary and keep the plan schema stable:

- Add a helper in [`contextExpansion.ts`](../src/analysis/consistency/decision/contextExpansion.ts:29)
  that, for a given request kind + candidate, returns the required parameters
  resolved from the candidate's claims (or `{}` for candidate-derived kinds), and
  `null` when a required parameter cannot be resolved.
- In [`indexedEngine.ts`](../src/analysis/consistency/indexedEngine.ts:555),
  build each request from that helper and **drop** requests that return `null`,
  so no parameterless request is ever issued.

Result: the required parameters reach the expanders and unresolvable requests are
omitted. No `plan.ts` schema change; `contextRequestsForQuestion(ctx)` tests
unchanged.

### 6 — tolerant per-item answer parsing

`parseModelJsonArray` validates the whole array with `z.array(itemSchema)`, so a
single malformed element returns `null`. Its semantics are asserted by
`tests/unit/ai/providers/modelJson.test.ts` and are relied on by extraction, so
**do not change it**. Instead add a loose sibling (e.g.
`parseModelJsonArrayLoose`) that returns `null` only when the payload is not a
JSON array, otherwise returns the items that pass `itemSchema.safeParse`
(dropping invalid ones). Use it in
[`SystemOneResponseMapper.parseResponse`](../src/analysis/consistency/decision/systemOne/SystemOneResponseMapper.ts:70).
`parseFailed` stays `rawAnswers === null`; a partially-valid array is readable,
so `parseFailed` becomes `false` and only the malformed items fall through to the
existing "Missing from model response" path. Add mapper tests: mixed
valid/invalid items keep the valid answers and keep `parseFailed === false`.

### 7 — decisionModel provenance

At [`indexedEngine.ts:795`](../src/analysis/consistency/indexedEngine.ts:795),
`decisionModel: options.decisionModel ?? request.model` claims a decision model
even when `decisionProvider` is `undefined`. Change to:

```ts
decisionProvider: decisionProvider?.name ?? "none",
decisionModel: decisionProvider === undefined ? "none" : (options.decisionModel ?? request.model),
```

Leave `generalModel: options.generalModel ?? request.model` unchanged.
`ConsistencySessionProvenanceSchema` already requires a string, so `"none"` fits.

### 8 — decisionParseFailed reflects the final outcome

At [`indexedEngine.ts:594-599`](../src/analysis/consistency/indexedEngine.ts:594),
after the single expansion rerun merges answers, `decisionParseFailed` is still
read from the first pass's `providerMetadata`. Capture the first-pass flag, then
after a **successful** rerun recompute the remaining unanswered questions with
`unansweredQuestions(rerunPlan, evaluation.answers)`; if the rerun answered all of
the affected questions, clear the flag (`false`). Read from the rerun's merged
question-level results, not `providerMetadata`. When the first pass threw
(`evaluation === null`) the flag stays `false`.

### 9 — DebuggingPanel provider check

At [`DebuggingPanel.tsx:91`](../src/taskpane/components/DebuggingPanel.tsx:91),
replace `isRemoteProviderConfigured(state.settings, state.providerConnections)`
with `isGeneralRoleConfigured(state)`, matching `SemanticReview`,
`SemanticStyle`, and `ConsistencyReview`. Update the import (drop
`isRemoteProviderConfigured`) and add `isGeneralRoleConfigured: () => true` to the
providerComposition mock in `tests/unit/taskpane/components/DebuggingPanel.test.tsx`
(the mock currently omits it and would throw).

### 10 — troubleshooting unbound-role predicates

In [`checks.ts`](../src/taskpane/troubleshooting/checks.ts:407), add
`input.consistency.decisionParseFailed === false` to the `appliesTo` of both
`decision-role-unbound` and `decision-fallback-general`, so a parse failure
surfaces only `decision-parse-failed`. Add a test in
`tests/unit/taskpane/troubleshooting/checks.test.ts`: an unbound role
(`decisionRoleConfigured: false`) with `unresolved > 0` and
`decisionParseFailed: true` yields `decision-parse-failed` and neither unbound
note. Existing tests (parse failure with the role bound) still pass.

### 11 — secret-free reflection unwrap

In [`LlmRole.ts`](../src/core/domain/LlmRole.ts:137), unwrap
`ZodOptional`/`ZodDefault`/`ZodNullable` (via `_def.innerType`) before the
`instanceof z.ZodString` check, so an optional/default/nullable string field
cannot slip past. `KNOWN_SAFE_STRING_FIELDS`, the enum handling (`role`,
`purpose`, `provider` are enums, not `ZodString`), and the fallback-policy
assertion stay unchanged. Add a test constructing a temporary schema with an
optional string to prove the unwrap path fails as intended, plus keep the
existing "known safe fields pass" assertion.

### 12 — reuse toggle visibility (partial)

The toggle lives inside the `configured ?` branch, so a decision role whose
binding exists but whose connection is missing/disconnected cannot set reuse.
Move it out of the configured branch and render it whenever
`canReuseGeneral && binding !== undefined`.

**Deviation:** the comment also asks to show it "when the decision role is
unconfigured … users with only a general binding can enable reuse". With no
decision binding there is no record to hold `reuseGeneral` (`setReuseGeneral`
throws), so rendering the toggle would be a no-op control. That part is skipped;
render only when a decision binding exists. Update
`tests/unit/taskpane/components/SettingsDashboard.test.tsx` (existing
configured-case and no-general-case tests stay green; add a stale-binding case).

### 13 — SettingsDashboard handleDisconnect

Currently deletes `providerConnections[binding.connectionId]` unconditionally and
never clears the binding or the gateway credential. Change
[`handleDisconnect`](../src/taskpane/components/SettingsDashboard.tsx:65) to:

1. Read `binding.connectionId`; return early if no binding.
2. Remove the role's binding from `llmRoleBindings`.
3. Delete the `providerConnections` entry **only when no remaining binding
   references that connection id** (a decision binding with `reuseGeneral` is
   treated as referencing the general binding's connection, per
   `connectionForRole`; compute "referenced" accordingly so a shared connection
   survives).
4. Call the gateway disconnect for the selected connection **best-effort**
   (create a gateway client, `void client.disconnect(connection).catch(...)`) so
   the local state change stays synchronous for the existing test; log a warning
   on failure.

Update `tests/unit/taskpane/components/SettingsDashboard.test.tsx`: existing
"disconnects a role by removing its connection" stays valid (single reference →
deleted); add a shared-connection case where the connection survives.

### 14 — SettingsDashboard handleConnect

`OpenRouterConnectionSettings` persists the connection itself, then calls
`onConnectionChange`, whose handler calls `handleConnect`, which calls
`onStateChange({ ...state, llmRoleBindings })` using the **stale** `state` prop —
dropping the just-persisted connection. In
[`handleConnect`](../src/taskpane/components/SettingsDashboard.tsx:74), set the
binding **and** merge the connection into `providerConnections` in the same
`onStateChange` call:

```ts
onStateChange({
  ...state,
  llmRoleBindings: setRoleBinding(state.llmRoleBindings, { ...binding }),
  providerConnections: {
    ...(state.providerConnections ?? {}),
    [connection.connectionId]: connection,
  },
});
```

Existing test (binding is created) still passes; add an assertion that the
connection is present in the new `providerConnections`.

### 15 — dev-gateway self-hosted approval gate

`handleApiKey` refuses a `userApprovedSelfHosted` classification unless
`body.approveSelfHosted === true`. `handleCallback` and `handleDeployment` never
apply the gate. Add the same rejection (403, same message) after `classified` is
computed in both, since neither accepts an approval flag. Update
`tests/unit/scripts/devGateway.test.ts`.

### 16 — dev-gateway authorize/callback state binding (dev-only)

Bind the callback to a gateway-issued authorization request:

- In the broker closure, retain pending states (e.g. a `Map<state, provider>` with
  a timestamp/expiry).
- `handleAuthorize`: generate a random `state`, retain it, and include it in the
  returned `authorizationUrl` (set/replace the `state` query parameter; for the
  default relative callback URL embed the generated state; for a caller-supplied
  `authorize` URL append/replace `state`).
- `handleCallback`: parse `callbackUrl` (relative-safe with a base), require a
  non-empty `code` and a `state` that matches a retained pending entry; consume
  it; otherwise reject (400/403) without creating a connection.

Update the callback tests: the "issues an OAuth connection on callback" case must
first call `/connections/authorize`, extract the state from the returned URL, and
pass a callback URL containing that state (plus a code). Keep the "no callback
URL" case.

This is a development-only stub hardening; the add-in does not currently use the
authorize/callback route from the UI.

### 17 — connection probe retries

`GatewayClient.request` always uses `this.maxRetries`, so a transient failure
during `testConnection` re-runs the provider test. Add an optional per-call
override to `request` (e.g. a trailing `maxRetriesOverride?: number`) used as
`maxRetriesOverride ?? this.maxRetries`, and pass `0` from
[`testConnection`](../src/ai/gateway/gatewayClient.ts:449). Other callers are
unchanged. Add/extend a gatewayClient test asserting no retry on a retryable
probe failure.

### 18 — expanded-context redaction

In [`SystemOneCompiler.buildPrompt`](../src/analysis/consistency/decision/systemOne/SystemOneCompiler.ts:69),
expanded-context content is added raw. Route it through the existing
`this.evidence(entry.content, plan)` helper (which returns exact text only when
`plan.allowUnredacted`, otherwise `redactSensitiveText`) before pushing to
`expandedByCandidate`, matching the claim-evidence handling. Note: expansion only
runs when `allowUnredacted` is true, so this is defensive, but it keeps the
compiler from being a raw-text path. Existing compiler tests use
`expandedContext: []` and stay green; add a test with `allowUnredacted: false`
and a redaction-shaped expanded entry.

### 19 — duplicated isRoleConfigured

`providerComposition.isRoleConfigured(role, bindings, connections)` resolves
`reuseGeneral`; `llmRoles.isRoleConfigured(binding, connections)` does not and has
a different signature. `llmRoles`' copy is **not imported anywhere in `src/`**
(only its own test), and `llmRoles` may not import `providerComposition`
(which pulls `ai/*`, breaking the module's documented boundary). The lazy,
aligned fix is to **delete** the unused duplicate and its tests in
`tests/unit/taskpane/settings/llmRoles.test.ts`, leaving one role-aware
implementation. If a caller is later reintroduced, it should use the
`providerComposition` version.

(Confirm during implementation that `llmRoles` is not re-exported from a barrel
before deleting — a search of `src/` found none.)

## Post-change documentation

Per `.roo/rules/zoo-rules-commit-docs.md`, only record what the change actually
does. These are defect fixes; no new architectural boundary is introduced with
the retrieval-layer approach (5), so no new ADR is required. Update
`docs/project-state.md` / stage status only if a gate claim changes, and keep the
Word-host gate reported as open.
