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
versioned (`version` field; v0→v1 is implemented). Legacy state is upgraded
on load, not discarded.

- When adding a new state version, add a migration step in
  `src/core/state/migration.ts` and bump the `version` in `StateSchema`.
- Migrations must preserve existing values over defaults and only fill
  missing fields.

**Evidence:** ADR-0015 in `docs/decision-log.md`;
`src/core/state/migration.ts`.

### 3. Write to both Office roamingSettings and localStorage

`saveState()` persists to `Office.roamingSettings` when available and falls
back to `localStorage` when the Office runtime is unavailable (e.g. unit
tests). Always call `saveAsync()` on roamingSettings so changes survive
add-in close.

- The storage key is versioned: `ToneForge.State.v1`.
- If both stores are available, write to both to prevent divergence.

**Evidence:** `src/core/state/persistence.ts` lines 34-80, STORAGE_KEY;
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
