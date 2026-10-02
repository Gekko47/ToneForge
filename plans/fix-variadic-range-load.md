# Fix: `Range.load` was declared variadic, and two call sites relied on it

**Status:** diagnosed, not yet fixed. Found from a real Word host on 2026-10-02, during
the P12 window this plan deliberately left open.

## The symptom

Pressing **Use current document** on Semantic Style produced:

> The document could not be read: The property 'start' is not available. Before
> reading the property's value, call the load method on the containing object and
> call `context.sync()` on the associated request context.

The wrapper sentence comes from
[`LearnSemanticStyle.tsx:96`](../src/taskpane/components/semantic/LearnSemanticStyle.tsx:96),
so the failure is in one of the two calls it wraps: `getDocumentSnapshot()` or
`getSelectionText()`.

## Root cause

Office.js `load` takes **one** argument:

```ts
load(propertyNames: string | string[]): Range
```

Two call sites pass three positional arguments:

- [`documentReader.ts:116`](../src/word/documentReader.ts:116) — `range.load("text", "start", "end")`
- [`selectionScope.ts:196`](../src/word/selectionScope.ts:196) — `range.load("text", "start", "end")`

The host loads `"text"` and **silently ignores the extra arguments**. The next line
reads `.start`, which was never loaded, and throws.

The reason this typechecked is that I widened the declaration to permit it:

```ts
// src/types/office.d.ts:180 — mine, added in P5
load: (...props: Array<string>) => Range;
```

`Font.load` at `office.d.ts:229` has the same widening, though no call site uses it
variadically.

## Why 2 350 tests never saw it

Two independent mocks were **more permissive than the host**:

- [`selectionScope.test.ts:105`](../tests/unit/word/selectionScope.test.ts:105) declares
  `load(...properties: string[])`, so it records and honours all three names.
- [`tests/setup.ts:63`](../tests/setup.ts:63) uses `load: vi.fn()`, which accepts
  anything and loads nothing.

The test asserting `selectionRequests === ["text", "start", "end", ...]` was, in
effect, asserting the mock's behaviour rather than the host's.

This is ADR-0084's lesson run backwards. ADR-0084 says a property the host lacks
must be a compile error. Here the failure is a declaration **widened to accommodate
a call** — the same class of lie, because both make the type system agree with
something the host does not do.

## Blast radius

| Path                                        | Affected                                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic Style → **Use current document**   | Throws. The route is unusable.                                                                                                                     |
| `getLiveSelection()` / `getSelectionText()` | Returns `null` in practice; every caller sees "no selection".                                                                                      |
| Deterministic Review                        | Not on this path today — but `getLiveSelection` is exported from `src/word/index.ts`, so the defect is one call site away from any other consumer. |

Both offending calls are in **P5 and P7 work**, and one (`documentReader.ts`) is
**pre-existing** — the same wrong call was there before this plan.

## The fix

1. **Restore the true signatures.** `Range.load` and `Font.load` become
   `load(propertyNames: string | string[]): ...`. Keep `Range.start`/`end` optional
   — that part of ADR-0084 is correct and loadable.
2. **Pass an array at both call sites.** `range.load(["text", "start", "end"])`.
3. **One shared mock, with real arity.** Extract a `officeLoad()` helper used by
   `tests/setup.ts` and `selectionScope.test.ts` that takes `string | string[]` and
   **throws** the host's `ItemNotFound` error when handed extra positional
   arguments. A variadic call then fails in tests, which is the entire point.
4. **A regression test** asserting that a variadic `load` throws rather than
   silently loading its first argument.
5. **Audit every Office mock** for the same over-permissiveness — a `vi.fn()` `load`
   is the same defect in another file, and this one is only visible in a host.

## Why this belongs in the plan rather than a hotfix

The two-line change is trivial and must be made. The rest is the point: **a mock
that is more permissive than the host is a hole in the test suite, and it has now
cost one shipped defect**. The 2 350 green tests and the 13 green stages said
"repository-complete" and were right about everything they could see — and this was
outside it. That is precisely the boundary ADR-0051 draws, and this is the first
piece of evidence the boundary is real.

It should also be read against the plan's own claim that P12 exists to catch
exactly this. It did.

## Docs to update

- `docs/decision-log.md` — ADR-0100, amending ADR-0084.
- `docs/manual-verification.md` — record this as host evidence, with the procedure
  that found it and the one that re-confirms the fix.
- `plans/semantic-review-systematic-implementation-plan.md` — a P13 entry, with the
  deviation attributed to P5 (the declaration) and P7 (the second call site).
- `docs/CHANGELOG.md` — the user-visible symptom, stated as what it was.
- `ROADMAP.md` — the ledger's P12 row moves from "procedures written" to
  "first host defect found and fixed; still open".
