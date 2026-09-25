# Profile record consolidation — single source of truth

## Problem

Persisted state currently holds three overlapping structures for the same
concept:

| Structure               | Written by               | Records                        |
| ----------------------- | ------------------------ | ------------------------------ |
| `profiles[]`            | `upsertProfile()`        | the set of profiles            |
| `profileHistory[id]`    | `upsertProfile()`        | every save (edit trail)        |
| `profileLifecycles[id]` | `saveProfileLifecycle()` | draft + published + activation |

Three consequences:

1. **Two write paths.** `upsertProfile()` writes the first two;
   `saveProfileLifecycle()` writes the third. Nothing forces them to agree.
2. **Redundant `profiles[]`.** It is a pure derivation of the keys of the
   other two structures.
3. **Revision numbers are meaningless.** `StyleProfile.version` is a semantic
   version, but two unrelated counters write to it:
   `ProfileEditor` bumps `patch` on every save, and `ProfileLifecycle.bump()`
   bumps `patch` for a different purpose. "1.0.7" means "the seventh save" in
   one place and something else in another.

## Decision

One record per profile owns all three concerns. Revisions are plain integers
assigned by the record. The audit trail stores full snapshots with a retention
cap of the newest 20, and published revisions are never dropped.

---

## Target contract

New module `src/core/domain/ProfileRecord.ts`, replacing
`src/core/domain/ProfileLifecycle.ts`.

```ts
// Full snapshot per revision. Self-identifying, so any revision is restorable
// and a ChangePlan can cite it by number.
StyleProfile.revision: number  // replaces version: ProfileVersion

PublishedVersionSchema = z.object({
  revision: z.number().int().positive(),
  at:       z.string().datetime(),
  profile:  StyleProfileSchema,
});

ProfileRevisionSchema = z.object({
  revision: z.number().int().positive(),
  at:       z.string().datetime(),
  action:   z.enum([
    "created", "draft-updated", "published",
    "activated", "restored", "draft-discarded",
  ]),
  detail:   z.string(),
  profile:  StyleProfileSchema,     // full snapshot
});

ProfileRecordSchema = z.object({
  id:                z.string().uuid(),
  name:              z.string(),                       // listable without opening
  draft:             StyleProfileSchema.nullable(),
  published:         z.array(PublishedVersionSchema),  // approved, immutable
  revisions:         z.array(ProfileRevisionSchema),   // audit trail
  activePublishedRevision: z.number().int().positive().nullable(),
  nextRevision:      z.number().int().positive(),      // monotonic counter
  createdAt:         z.string().datetime(),
  updatedAt:         z.string().datetime(),
});
```

Transitions, all pure, all appending exactly one audit entry:
`createRecord`, `updateDraft`, `publishDraft`, `activatePublished`,
`restoreAsDraft`, `discardDraft`, `trimRevisions`.

`trimRevisions(record, keep = 20)`: keep the newest 20 entries, and never drop
an entry whose `revision` appears in `published[].revision`. This is why
`published` entries carry their revision number — the cap needs the link.

`effectiveProfile(record)`: active published profile, else draft, else null.

### Why `StyleProfile` keeps a number

The profile snapshot carries its own `revision`. Alternatives (revision held
only on the record, threaded as a parallel argument through every analysis
entry point) require plumbing a second value alongside every profile that is
already passed by reference, and make stored snapshots non-self-describing.
Self-identifying snapshots are what make a `ChangePlan.profileRevision` claim
verifiable after the fact.

### Revision numbers in plans and requests

| Contract         | From                      | To                                 |
| ---------------- | ------------------------- | ---------------------------------- |
| `ChangePlan`     | `profileVersion?: string` | `profileRevision?: number`         |
| `ReviewRequest`  | `profileVersion: string`  | `profileRevision: number`          |
| `ResolvedPolicy` | `profileVersion: string`  | `profileRevision: number`          |
| `PlanOptions`    | `profileVersion?: string` | `profileRevision?: number`         |
| `TaskPaneHeader` | `profileVersion: string`  | `profileRevision: number` (`r{n}`) |

`profileRevision` and the existing `governancePolicyRevision` are now both
integers and mean the same kind of thing: "which version of what was this
built from".

---

## Persistence

`StateSchema` v7:

```ts
profileRecords: z.record(z.string().uuid(), ProfileRecordSchema).default({});
```

Removed: `profiles`, `profileHistory`, `profileLifecycles`.
`STORAGE_KEY` → `ToneForge.State.v7`; `v6` joins the legacy key list.
`CURRENT_STATE_VERSION = 7`.

Deleted: `upsertProfile()`, `appendSnapshot()`, `appendGovernanceSnapshot()`,
`sameSnapshot()`, `saveProfileLifecycle()`, `loadProfileLifecycle()`.
Added: `saveProfileRecord(record)`, `loadProfileRecord(id)`.

Governance stays keyed by profile id (`governanceProfiles`,
`governanceHistory`) — it is a separate concern with its own version counter
and is not part of this consolidation.

### Migration v6 → v7

For each id in `profiles`:

- `name` ← `profile.name`
- `revisions` ← `profileHistory[id]` (oldest → newest), each mapped to
  `{ revision: i + 1, at: snapshot.updatedAt, action: "draft-updated", ... }`
- `published` ← `profileLifecycles[id].published`, each tagged with its index
  as the revision number
- `draft` ← `profileLifecycles[id].draft`
- `activePublishedRevision` ← index of `activePublishedId` in `published`
- `nextRevision` ← `max(revisions.length, published.length) + 1`

The two trails genuinely differ, so nothing is discarded: the edit trail
becomes `revisions`, the approval trail becomes `published`. Where a revision
number appears in both, the published entry is authoritative for that number.

---

## Call-site impact

**`src/core/domain/`**

- `StyleProfile.ts` — delete `ProfileVersionSchema`, `formatProfileVersion`,
  `version` field; add `revision: z.number().int().nonnegative()`;
  `createEmptyProfile(name)` drops its version parameter
- `ChangePlan.ts`, `ReviewRequest.ts`, `ResolvedPolicy.ts` — `profileVersion`
  → `profileRevision: number`
- `index.ts` — update barrel exports
- delete `ProfileLifecycle.ts`

**`src/style/versioning.ts`**

- delete `bumpProfileVersion`, `BumpType`, `formatVersion`
- `ProfileDiff.fromVersion`/`toVersion` → `fromRevision`/`toRevision: number`
- `diffProfiles()` unchanged otherwise — it already diffs content fields

**`src/changes/planner.ts`**, **`src/reformat/orchestrator.ts`**,
**`src/ai/review/spotReview.ts`**, **`src/ai/review/documentEditorialReview.ts`**
— pass `profile.revision` instead of `formatProfileVersion(profile.version)`

**`src/taskpane/`**

- `pages/Profile.tsx` — use `loadProfileRecord`
- `pages/Dashboard.tsx` — `activeProfileKey` uses `profile.revision`; two
  `TaskPaneHeader` call sites pass a number
- `components/TaskPaneHeader.tsx` — `profileRevision: number`
- `components/ProfileLifecycleSection.tsx` — becomes `ProfileRecordSection`,
  lists published versions by revision number and renders the audit trail
- `components/ProfileEditor.tsx` — no `bumpProfileVersion`; saves go through
  `updateDraft`, which assigns the next revision; version picker reads
  `revisions`
- `components/SmokePanel.tsx` — read via selector
- `components/ProfileHistoryCompare.tsx` — unchanged; consumes two profiles

**New `src/core/state/profileSelectors.ts`** (pure, unit-testable, replaces the
deleted `profiles[]` access):

```ts
selectAllProfiles(state): StyleProfile[]   // effective profile per record
selectActiveProfile(state): StyleProfile | null
selectRecordList(state): { id; name; revision }[]
selectRevisions(state, id): ProfileRevision[]
```

---

## Tests

Rewrite or update:

- `tests/unit/style/versioning.test.ts` — drop the 4 `bumpProfileVersion`
  cases; `diffProfiles` revision assertions become numbers
- `tests/unit/core/domain/StyleProfile.test.ts` — revision instead of version
- `tests/unit/core/domain/ProfileLifecycle.test.ts` → `ProfileRecord.test.ts`
  — plus new cases: revision numbers are monotonic; the cap keeps the newest
  20; a published revision is never trimmed; `trimRevisions` is idempotent
- `tests/unit/core/state/persistence*.test.ts` — `profiles`/`profileHistory`
  assertions become record assertions
- new `tests/unit/core/state/profileMigration.test.ts` — v6 → v7 preserves both
  trails, active published revision survives, multiple profiles survive, a
  corrupt record does not discard other profiles
- new `tests/unit/core/state/profileSelectors.test.ts`
- `tests/unit/taskpane/components/ProfileEditor.test.tsx` — mocked
  `upsertProfile` → `updateDraft`
- `tests/fixtures/sampleDocs.ts`, `GovernanceProfile.test.ts`,
  `ResolvedPolicy.test.ts`, `reviewPipeline.test.ts`, `TaskPaneHeader.test.tsx`
  — fixture field renames

---

## Storage

A full `StyleProfile` is a few KB. Worst case per profile is
20 revisions + all published versions. `Office.roamingSettings` is a bounded
store, so the acceptance check measures serialized state size with 20+ revisions
on 3 profiles and confirms the save does not silently fail. If it is too large,
lower the cap rather than storing diffs.

---

## Documentation

- ADR-0048 — supersede ADR-0046's "two persisted structures" consequence:
  `profileRecords` is the single source of truth
- `ROADMAP.md` — Phase 3 evidence updated
- `docs/project-state.md`, `docs/CHANGELOG.md` — state v7, counts
- `docs/architecture.md` — persistence section

---

## Sequence

1. `ProfileRecord` domain module + tests (pure, no callers yet)
2. `StyleProfile` revision change + `versioning.ts` trim
3. `ChangePlan`/`ReviewRequest`/`ResolvedPolicy` revision fields
4. v7 schema + migration + selectors; delete the old persistence API
5. Rewrite the four call sites
6. UI: `ProfileRecordSection`, `ProfileEditor`, `TaskPaneHeader`, `Profile`
7. Test sweep
8. `npm run verify`, docs, commit
