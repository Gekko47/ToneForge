---
name: toneforge-persistence-state
description: Persist state gracefully — fall back to defaults on corrupt data and wire versioned migrations into loadState.
---

# Persistence & State

Application state must survive restarts without crashing the add-in.
Corrupt or version-incompatible state must fall back to defaults; migrations
must be wired into the load path.

## When to use

- Modifying `src/core/state/persistence.ts` or `src/core/state/migration.ts`.
- Adding new persisted fields or changing the state schema.
- Debugging startup crashes, lost settings, or migration failures.

## Rules

### 1. `loadState()` never throws on corrupt data

`loadState()` catches parse/validation failures and returns defaults,
logging a warning. Users must never see a startup crash from bad state.

- If persisted data is corrupt, return the default state (empty profiles,
  null active profile, default settings).
- Log a warning via `logger.warn` so the failure is visible in diagnostics.

**Evidence:** ADR-0010 in `docs/decision-log.md`;
`src/core/state/persistence.ts` (catch + defaults pattern).

### 2. Migrations run before schema parse

`loadState()` calls `migrate(raw)` before `StateSchema.parse`. Migration is
versioned (`CURRENT_STATE_VERSION`, currently 13). Legacy state is upgraded
on load, not discarded.

- When adding a new state version, **add** a migration step — do not edit an
  existing one, since earlier versions may still be in a user's storage.
- Bump `CURRENT_STATE_VERSION` and `STORAGE_KEY`, and add the previous key to
  `LEGACY_STORAGE_KEYS` so it is read and then purged.
- Migrations must preserve existing values over defaults and only fill
  missing fields.
- New consent flags are **set** to `false`, never derived from another flag.

**Evidence:** ADR-0015 in `docs/decision-log.md`;
`src/core/state/migration.ts`.

### 3. Write to both Office roamingSettings and localStorage

`saveState()` persists to `Office.roamingSettings` when available and falls
back to `localStorage` when the Office runtime is unavailable (e.g. unit
tests). Always call `saveAsync()` on roamingSettings so changes survive
add-in close.

- The storage key is versioned. `CURRENT_STATE_VERSION` is **13** and
  `STORAGE_KEY` is `ToneForge.State.v13`; v12 and earlier are in
  `LEGACY_STORAGE_KEYS`.
- `ProfileRecord` is the single persisted store for a profile: one mutable
  draft, immutable published versions with explicit activation and
  restore-as-draft, and an append-only revision audit trail capped at the
  newest 20 plus every published revision. A `ChangePlan` cites the exact
  integer revision it was built from.
- **Persisted state never holds a credential.** It carries provider, model,
  broker configuration, and consent only. Legacy `openAiApiKey` values are
  stripped and legacy keys purged while consent is preserved.
- Optional settings are omitted when cleared rather than persisted as `""`.

**Evidence:** `src/core/state/persistence.ts`; `src/core/domain/ProfileRecord.ts`;
ADR-0007.

### 4. State schema is Zod-validated

`StateSchema` in `persistence.ts` defines the persisted shape with Zod.
All fields have `.default()` values so partial/legacy data parses safely.

**Evidence:** `src/core/state/persistence.ts` lines 16-28.

## Referenced resources

- `src/core/state/persistence.ts` — load/save with fallback and migration
- `src/core/state/migration.ts` — versioned migrations
- `docs/decision-log.md` — ADR-0007, ADR-0010, ADR-0015
- `docs/privacy-security.md` — storage encryption notes
