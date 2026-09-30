---
paths:
  - "src/core/state/**"
  - "src/core/domain/ProfileRecord.ts"
  - "src/taskpane/state/**"
  - "src/taskpane/settings/**"
---

# Persistence and State

State must survive restarts without crashing the add-in, and must never carry a
credential.

## Current facts

- `CURRENT_STATE_VERSION` is **13**; `STORAGE_KEY` is `ToneForge.State.v13`, with
  v12 and earlier in `LEGACY_STORAGE_KEYS`.
- `ProfileRecord` is the single persisted store for a profile: one mutable draft,
  immutable published versions with explicit activation and restore-as-draft, and
  an append-only revision audit trail capped at the newest 20 plus every published
  revision. A `ChangePlan` cites the exact integer revision it was built from.
- Ordinary state holds provider, model, broker configuration, and consent —
  **never a key**.

## Rules

### 1. `loadState()` never throws on corrupt data

It catches parse and validation failures and returns defaults, logging a warning.
A user must never see a startup crash because of bad state.

### 2. Migrations run before schema parse, and they are additive

`loadState()` calls `migrate(raw)` before `StateSchema.parse`. To add a version:

1. **Add** a migration step — do not edit an existing one. Earlier versions may
   still be present in a user's storage.
2. Bump `CURRENT_STATE_VERSION` and `STORAGE_KEY`, and add the previous key to
   `LEGACY_STORAGE_KEYS` so it is read and then purged.
3. Preserve existing values over defaults, and fill only what is missing.
4. Set new consent flags explicitly to `false`; never derive a consent from
   another flag.

### 3. Write both stores

`saveState()` writes to `Office.roamingSettings` when available and falls back to
`localStorage`, always calling `saveAsync()` so changes survive add-in close.

### 4. Credentials are stripped, not migrated

Legacy `openAiApiKey` values are removed and legacy storage keys purged, while
consent is preserved. Every consent flag is re-derived from a strict boolean by
`normalizeSettings`, so a stored `"yes"` cannot read as permission.

### 5. Optional settings are cleared, not stored empty

A blank optional broker setting is omitted from the persisted record rather than
saved as `""`.

## Referenced resources

- [src/core/state/persistence.ts](../../src/core/state/persistence.ts) — load, save, schema
- [src/core/state/migration.ts](../../src/core/state/migration.ts) — versioned migrations
- [src/core/state/profileSelectors.ts](../../src/core/state/profileSelectors.ts) — pure projections
- [docs/decision-log.md](../../docs/decision-log.md) — ADR-0007, ADR-0010, ADR-0015
