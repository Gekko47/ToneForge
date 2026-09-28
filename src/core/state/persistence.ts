/**
 * Application state persistence.
 *
 * Primary store: Office roamingSettings (survives across sessions).
 * Fallback: localStorage (used when Office runtime is unavailable).
 *
 * `profileRecords` is the single source of truth for style profiles: one record
 * per profile holds its draft, published versions, and revision audit trail.
 * There is no separate profile list or history map, so no two structures can
 * disagree. Credentials are not part of ordinary state; legacy credential
 * fields are removed during migration and their legacy storage records purged.
 */

import { z } from "zod";
import { logger } from "../../shared/utils/logger";
import { type StyleProfile } from "../domain/StyleProfile";
import { ProviderConnectionSchema, ProviderIdSchema } from "../domain/ProviderConnection";
import {
  createGovernanceProfile,
  GovernanceProfileSchema,
  type GovernanceProfile,
} from "../domain/GovernanceProfile";
import {
  createRecord,
  effectiveProfile,
  newProfileId,
  ProfileRecordSchema,
  type ProfileRecord,
} from "../domain/ProfileRecord";
import {
  IgnoredFindingSchema,
  ReviewedFindingSchema,
  type IgnoredFinding,
  type ReviewedFinding,
} from "../domain/Finding";
import { CURRENT_STATE_VERSION, migrate } from "./migration";

const StateSchema = z.object({
  version: z.number().int().nonnegative().default(12),
  profileRecords: z.record(z.string().uuid(), ProfileRecordSchema).default({}),
  activeProfileId: z.string().uuid().nullable().default(null),
  governanceProfiles: z.record(z.string().uuid(), GovernanceProfileSchema).default({}),
  governanceHistory: z.record(z.string().uuid(), z.array(GovernanceProfileSchema)).default({}),
  activeGovernanceProfileId: z.string().uuid().nullable().default(null),
  /**
   * Semantic style profiles: tone, voice, register, and learned style.
   *
   * A **separate map**, not a second entry in `profileRecords` under a composite
   * key. The keys of `profileRecords` are uuids validated by
   * `z.string().uuid()`; a `"deterministic:<uuid>"` key would fail that check and
   * would have to weaken the schema for every existing consumer. Two maps keep
   * both namespaces uuid-keyed and independently addressable.
   */
  semanticProfileRecords: z.record(z.string().uuid(), ProfileRecordSchema).default({}),
  /**
   * The active semantic profile, or null when the user has not created one.
   *
   * Null is a real state, not a missing field: the Semantic Style Review tab has
   * nothing to act on until Learn Style runs, and it must say so rather than
   * silently falling back to the deterministic profile.
   */
  activeSemanticProfileId: z.string().uuid().nullable().default(null),
  /**
   * Findings the user chose to ignore, keyed by fingerprint.
   *
   * Keyed by fingerprint rather than `finding.id` because ids are minted per
   * scan: the same rule firing on the same text gets a new id every time, so
   * keying by id would make every ignore expire at the next rescan.
   */
  ignoredFindings: z.array(IgnoredFindingSchema).default([]),
  /**
   * Findings the user has reviewed, as decisions rather than as status labels.
   *
   * v12. This was previously a bare `Set` of review keys held in
   * `localStorage["ToneForge.ReviewedFindingFingerprints.v1"]` and mirrored into
   * component state. Two things were wrong with that: the write never went
   * through the store's change notification, so the pane re-rendered only by
   * accident, and the set had no room to record *what* was decided — so a
   * finding reviewed when no plan existed was indistinguishable from one never
   * reviewed, and Pending Changes could not tell a review that admitted a change
   * from one that did not.
   *
   * Keyed by occurrence identity, which both runs derive identically. See
   * `ReviewedFinding` and `occurrenceIdentity` for why that identity is exact.
   */
  reviewedFindings: z.array(ReviewedFindingSchema).default([]),
  settings: z
    .object({
      openAiBaseUrl: z.string().url().optional(),
      openAiModel: z.string().optional(),
      // v8 widens this from the OpenAI-only pair. `openAiBaseUrl` and
      // `openAiModel` are retained for the local development path and are
      // superseded by a stored `providerConnections` entry once one exists.
      llmProvider: z.enum(["openai", "anthropic", "openrouter", "mock"]).default("mock"),
      openAiCredentialMode: z.literal("broker").default("broker"),
      /**
       * v11. Whether the document observer scans on every change.
       *
       * Defaults to true so the existing behaviour is preserved. Turning it off
       * leaves scanning to the Re-scan Now button, which always performs a full
       * document scan. Auto-preview is deliberately **not** a setting: a preview
       * that can be switched off can be mistaken for an up-to-date one.
       */
      autoScan: z.boolean().default(true),
      /**
       * v9. The third and separate consent, belonging only to the cross-report
       * consistency engine.
       *
       * This is not derived from `semanticOptIn` and must never be. A user who
       * agreed to send a selection for a style review has not agreed to send a
       * whole document to be compared pairwise against itself by a
       * non-deterministic engine. Defaults to false, so a pre-v9 user who has
       * never seen this control cannot have it silently switched on.
       */
      consistencyReviewConsent: z.boolean().default(false),
      semanticOptIn: z.boolean().default(false),
    })
    .default({}),
  /**
   * Provider-neutral, non-secret connection records keyed by provider id.
   * This is the only provider structure that may be persisted, and it has no
   * field capable of holding a credential.
   */
  // Optional rather than defaulted: a v7 record has no such field, and making it
  // required in the inferred type would break every existing state fixture.
  // `migrate()` always populates it, so callers never see `undefined` at runtime.
  providerConnections: z.record(ProviderIdSchema, ProviderConnectionSchema).optional(),
});

export type PersistedState = z.infer<typeof StateSchema>;

const STORAGE_KEY = "ToneForge.State.v12";
const LEGACY_STORAGE_KEYS = [
  "ToneForge.State.v11",
  "ToneForge.State.v10",
  "ToneForge.State.v9",
  "ToneForge.State.v8",
  "ToneForge.State.v7",
  "ToneForge.State.v6",
  "ToneForge.State.v5",
  "ToneForge.State.v4",
  "ToneForge.State.v3",
  "ToneForge.State.v2",
  "ToneForge.State.v1",
] as const;

/**
 * The occurrence key for a stored ignore, derived from its stored fields.
 *
 * `core/state` cannot import `taskpane/occurrenceIdentity`: that module lives in
 * the UI layer and imports the fingerprint helper from here. The derivation is
 * duplicated rather than shared so the dependency stays one-way, and it is
 * pinned by a test that asserts the two produce the same string for the same
 * finding — a divergence would resurrect the exact "ignoring a second item brings
 * back the first" defect the key exists to fix.
 */
function occurrenceKeyFor(entry: IgnoredFinding): string {
  return [
    entry.fingerprint,
    [...entry.nodeIds].sort().join(","),
    entry.range.start,
    entry.range.end,
  ].join("@");
}

/**
 * Whether a review and an ignore describe the same occurrence.
 *
 * Compared on rule, node, and position rather than on either key: the two keys
 * are built for different lookup paths, and this is a cross-check between them.
 */
function isSameIgnoredOccurrenceIdentity(review: ReviewedFinding, entry: IgnoredFinding): boolean {
  return (
    review.category === entry.category &&
    review.range.start === entry.range.start &&
    review.range.end === entry.range.end &&
    [...review.nodeIds].sort().join(",") === [...entry.nodeIds].sort().join(",")
  );
}

function isOfficeRuntime(): boolean {
  return typeof (globalThis as unknown as { Office?: unknown }).Office !== "undefined";
}

function parsePersistedValue(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getRoamingSettings(): Record<string, unknown> | null {
  if (!isOfficeRuntime()) return null;
  try {
    const office = (
      globalThis as unknown as {
        Office?: { roamingSettings?: { get: (k: string) => unknown } };
      }
    ).Office;
    const settings = office?.roamingSettings;
    if (!settings) return null;

    return (
      parsePersistedValue(settings.get(STORAGE_KEY)) ??
      LEGACY_STORAGE_KEYS.map((key) => parsePersistedValue(settings.get(key))).find(
        (value) => value !== null,
      ) ??
      null
    );
  } catch {
    return null;
  }
}

async function setRoamingSettingsAsync(value: Record<string, unknown>): Promise<void> {
  const office = (
    globalThis as unknown as {
      Office?: {
        roamingSettings?: {
          set: (k: string, v: unknown) => void;
          remove?: (k: string) => void;
          saveAsync: (cb?: (result: unknown) => void) => void;
        };
      };
    }
  ).Office;
  const settings = office?.roamingSettings;
  if (!settings) return;
  settings.set(STORAGE_KEY, JSON.stringify(value));
  LEGACY_STORAGE_KEYS.forEach((key) => settings.remove?.(key));
  await new Promise<void>((resolve) => {
    try {
      settings.saveAsync(() => resolve());
    } catch {
      resolve();
    }
  });
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length(): number {
      return store.size;
    },
  };
}

const memoryStorage = createMemoryStorage();

function getSafeStorage(): Storage {
  if (typeof window !== "undefined") {
    try {
      return window.localStorage ?? memoryStorage;
    } catch {
      return memoryStorage;
    }
  }

  // Do not probe Node's experimental global localStorage getter. Non-browser
  // callers still get a usable, process-local fallback.
  return memoryStorage;
}

function getLocalStorage(): Record<string, unknown> | null {
  const storage = getSafeStorage();
  try {
    return (
      parsePersistedValue(storage.getItem(STORAGE_KEY)) ??
      LEGACY_STORAGE_KEYS.map((key) => parsePersistedValue(storage.getItem(key))).find(
        (value) => value !== null,
      ) ??
      null
    );
  } catch {
    return null;
  }
}

function setLocalStorage(value: Record<string, unknown>): void {
  try {
    const storage = getSafeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
    LEGACY_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
  } catch (err: unknown) {
    /*
     * Logged rather than swallowed.
     *
     * This was a silent catch, and it hid a write failing for a reason the
     * caller could not act on: the ignore button appeared to do nothing, and
     * nothing anywhere said the store had rejected the write. A storage failure
     * is rare but the pane's whole state model assumes writes land, so a failed
     * one has to be visible to diagnose.
     */
    logger.error("Failed to persist state to localStorage", {
      errorType: err instanceof Error ? err.name : "Unknown",
    });
  }
}

/**
 * Load persisted state.
 *
 * Raw persisted bytes are migrated to the current schema version BEFORE
 * validation, so legacy v0-v6 state is upgraded instead of discarded.
 */
export function loadState(): PersistedState {
  const raw = getRoamingSettings() ??
    getLocalStorage() ?? {
      version: CURRENT_STATE_VERSION,
      profileRecords: {},
      activeProfileId: null,
      settings: {},
    };

  // Migrate before parsing so versioned state upgrades are applied.
  const migrated = migrate(raw);

  try {
    const parsed = StateSchema.parse(migrated);
    if (
      rawContainsLegacyCredential(raw) ||
      (typeof raw.version === "number" && raw.version < CURRENT_STATE_VERSION) ||
      !Object.prototype.hasOwnProperty.call(raw, "governanceHistory") ||
      !Object.prototype.hasOwnProperty.call(raw, "profileRecords")
    ) {
      // Silent: this is a read that repaired the store, not a user-initiated
      // write. Notifying here would wake every subscriber on a plain read.
      writeState(parsed, false);
    }
    return parsed;
  } catch (err) {
    // Corrupted or incompatible persisted state: fall back to defaults
    // rather than crashing the add-in. The previous value is unrecoverable.
    logger.warn("Failed to parse persisted state; falling back to defaults", {
      errorType: err instanceof Error ? err.name : "Unknown",
    });
    return migrate(null);
  }
}

/**
 * Save state. localStorage is written synchronously so callers can rely on
 * it. Office roamingSettings is persisted asynchronously via saveAsync;
 * failures are logged but never thrown.
 */
type StateListener = () => void;

const stateListeners = new Set<StateListener>();

/**
 * Subscribe to persisted-state changes.
 *
 * Every writer in this module notifies through here rather than leaving it to
 * each caller. The writers below are convenience functions that call
 * `saveState` directly, and a save that does not notify leaves the UI showing
 * the pre-save value: the ignore button wrote its entry to storage, the list
 * did not re-render, and the control looked broken while having worked.
 * Notification belongs to the write, not to the component that happened to
 * trigger it.
 */
export function subscribeToState(listener: StateListener): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

/** Notify after a save, so subscribers re-read rather than trusting the payload. */
function notifyStateChanged(): void {
  stateListeners.forEach((listener) => {
    listener();
  });
}

/**
 * Write the state.
 *
 * `notify` is a parameter rather than always-on because `loadState` writes: it
 * self-heals a store that is missing fields by saving the migrated value, and
 * that save is a *read* in disguise. Notifying from it would make every read
 * of a half-built store wake every subscriber, which under
 * `useSyncExternalStore` is a render loop rather than a single extra render.
 * Only a write the caller actually asked for notifies.
 */
function writeState(state: PersistedState, notify: boolean): void {
  const parsed = StateSchema.parse(state);
  const payload = { ...parsed };

  // Always write localStorage synchronously.
  setLocalStorage(payload);

  // Persist to Office roamingSettings asynchronously (best-effort).
  if (isOfficeRuntime()) {
    setRoamingSettingsAsync(payload).catch((err: unknown) => {
      logger.error("Failed to persist to Office roamingSettings", {
        errorType: err instanceof Error ? err.name : "Unknown",
      });
    });
  }

  if (notify) notifyStateChanged();
}

export function saveState(state: PersistedState): void {
  writeState(state, true);
}

/** Remove any legacy persisted credential and select the broker/mock-safe default. */
export function clearPersistedCredentials(): PersistedState {
  const state = loadState();
  const cleared: PersistedState = {
    ...state,
    settings: {
      ...state.settings,
      llmProvider: "mock",
      openAiCredentialMode: "broker",
    },
    providerConnections: {},
  };
  saveState(cleared);
  return cleared;
}

function rawContainsLegacyCredential(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const settings = (raw as Record<string, unknown>).settings;
  return (
    !!settings &&
    typeof settings === "object" &&
    !Array.isArray(settings) &&
    Object.prototype.hasOwnProperty.call(settings, "openAiApiKey")
  );
}

function appendGovernanceSnapshot(
  history: readonly GovernanceProfile[],
  profile: GovernanceProfile,
): GovernanceProfile[] {
  const latest = history[history.length - 1];
  return latest && JSON.stringify(latest) === JSON.stringify(profile)
    ? [...history]
    : [...history, profile];
}

/**
 * Persist a profile record together with its governance policy.
 *
 * Records are the only writer of profile data. When a profile is new, an
 * initial governance profile is seeded so normative policy always exists for
 * the record's style; when it already exists, the wrapped style snapshot is
 * refreshed to match the record's effective profile (the active published
 * version, else the draft), so governance never cites an unpublished draft.
 */
export function saveProfileRecord(record: ProfileRecord): void {
  const state = loadState();
  const parsed = ProfileRecordSchema.parse(record);
  state.profileRecords[parsed.id] = parsed;

  const style = effectiveProfile(parsed);
  if (style) {
    const existing = state.governanceProfiles[parsed.id];
    const nextGovernance = existing
      ? GovernanceProfileSchema.parse({ ...existing, style })
      : GovernanceProfileSchema.parse({ ...createGovernanceProfile(style), id: parsed.id });
    state.governanceProfiles[parsed.id] = nextGovernance;
    const history = state.governanceHistory[parsed.id] ?? [nextGovernance];
    state.governanceHistory[parsed.id] = appendGovernanceSnapshot(history, nextGovernance);
  }

  saveState(state);
}

/**
 * Replace a record's governance policy, versioning and recording the change.
 *
 * `saveProfileRecord` is the only other writer of governance data and it
 * refreshes only the wrapped style, so before this the normative half of the
 * contract — rules, terminology, scope, protection, editorial — was written by
 * nobody and was permanently the schema defaults.
 *
 * Every save bumps `version` and appends to `governanceHistory`, so the audit
 * trail is not optional: a policy the author cannot see the history of is a
 * policy they cannot safely change. `ChangePlan` already cites
 * `governancePolicyRevision`, so a plan built under an older policy is refused
 * at apply time.
 *
 * Throws rather than writing a policy that would silently protect nothing. The
 * failure a caller most needs to hear about is "you just excluded every kind of
 * content from analysis", and a schema with no rule against it would accept it.
 */
export function updateGovernancePolicy(
  id: string,
  policy: Omit<GovernanceProfile, "version"> & { version?: number },
): GovernanceProfile {
  const state = loadState();
  const previous = state.governanceProfiles[id];
  if (!previous) {
    throw new Error(`updateGovernancePolicy: no governance profile for "${id}"`);
  }
  const next = GovernanceProfileSchema.parse({
    ...policy,
    id,
    version: previous.version + 1,
  });
  if (policy.style.id !== previous.style.id) {
    throw new Error("updateGovernancePolicy: a policy cannot change the style profile it governs");
  }
  state.governanceProfiles[id] = next;
  const history = state.governanceHistory[id] ?? [];
  state.governanceHistory[id] = appendGovernanceSnapshot(history, next);
  saveState(state);
  return next;
}

/**
 * Read a profile record, or null when the profile does not exist. Callers that
 * need a record for a new profile create one with `createRecord`.
 */
export function loadProfileRecord(id: string): ProfileRecord | null {
  return loadState().profileRecords[id] ?? null;
}

/** Create and persist a brand new record, seeding governance from the draft. */
export function createProfileRecord(name: string, now: string, seed?: StyleProfile): ProfileRecord {
  const record = createRecord(newProfileId(), name, now, seed);
  saveProfileRecord(record);
  return record;
}

export function removeProfile(id: string): void {
  const state = loadState();
  const nextRecords = { ...state.profileRecords };
  delete nextRecords[id];
  state.profileRecords = nextRecords;
  const nextGovernanceHistory = { ...state.governanceHistory };
  delete nextGovernanceHistory[id];
  state.governanceHistory = nextGovernanceHistory;
  const nextGovernanceProfiles = { ...state.governanceProfiles };
  delete nextGovernanceProfiles[id];
  state.governanceProfiles = nextGovernanceProfiles;
  if (state.activeProfileId === id) state.activeProfileId = null;
  if (state.activeGovernanceProfileId === id) state.activeGovernanceProfileId = null;
  saveState(state);
}

export function setActiveProfile(id: string | null): void {
  const state = loadState();
  state.activeProfileId = id;
  saveState(state);
}

// ---------------------------------------------------------------------------
// Semantic namespace writers
//
// Deliberately separate functions rather than a `kind` parameter on the
// deterministic ones. `saveProfileRecord` seeds a governance profile for every
// record it writes, and that must **not** happen here: governance policy is a
// single thing that governs all three engines, keyed by the deterministic style
// profile. A second policy seeded from a semantic record would be a second
// source of truth for what the consistency engine is allowed to touch.
// ---------------------------------------------------------------------------

/**
 * Persist a semantic profile record. Does not seed or refresh governance.
 *
 * The asymmetry with `saveProfileRecord` is the point: the governance tab
 * edits one policy, and this namespace is governed by it rather than owning one.
 */
export function saveSemanticProfileRecord(record: ProfileRecord): void {
  const state = loadState();
  const parsed = ProfileRecordSchema.parse({ ...record, kind: "semantic" });
  state.semanticProfileRecords[parsed.id] = parsed;
  saveState(state);
}

/** Read a semantic profile record, or null when it does not exist. */
export function loadSemanticProfileRecord(id: string): ProfileRecord | null {
  return loadState().semanticProfileRecords[id] ?? null;
}

/** Create and persist a new semantic profile record, and make it active. */
export function createSemanticProfileRecord(
  name: string,
  now: string,
  seed?: StyleProfile,
): ProfileRecord {
  const record = createRecord(newProfileId(), name, now, seed, "semantic");
  saveSemanticProfileRecord(record);
  setActiveSemanticProfile(record.id);
  return record;
}

/**
 * Choose the active semantic profile, or null when there is none.
 *
 * Null is a real state the Semantic Style Review tab has to render: with no
 * profile there is no style to apply, and falling back to the deterministic one
 * would rewrite a paragraph against typography rules.
 */
export function setActiveSemanticProfile(id: string | null): void {
  const state = loadState();
  if (id !== null && state.semanticProfileRecords[id] === undefined) {
    throw new Error(`setActiveSemanticProfile: no semantic profile record for "${id}"`);
  }
  state.activeSemanticProfileId = id;
  saveState(state);
}

/**
 * Delete a semantic profile record, clearing the active id when it pointed here.
 */
export function removeSemanticProfile(id: string): void {
  const state = loadState();
  if (state.semanticProfileRecords[id] === undefined) return;
  const next = { ...state.semanticProfileRecords };
  delete next[id];
  state.semanticProfileRecords = next;
  if (state.activeSemanticProfileId === id) state.activeSemanticProfileId = null;
  saveState(state);
}

/**
 * Record an ignored finding, replacing any entry for the same occurrence.
 *
 * **Dedupe is on the occurrence key, not the fingerprint.** The fingerprint is
 * the identity of a *rule* — it deliberately excludes the range — so filtering
 * on it meant that ignoring the second em dash in a document deleted the entry
 * for the first. The finding the user had already set aside reappeared, and
 * nothing on screen said why. Two hits of one rule are now two independently
 * ignorable occurrences, which is what "ignore this one" has always meant to the
 * person clicking it.
 */
export function ignoreFinding(entry: IgnoredFinding): void {
  const parsed = IgnoredFindingSchema.parse({
    ...entry,
    occurrenceKey: entry.occurrenceKey.length > 0 ? entry.occurrenceKey : occurrenceKeyFor(entry),
  });
  const state = loadState();
  const retained = state.ignoredFindings.filter(
    (item) => item.occurrenceKey !== parsed.occurrenceKey,
  );
  state.ignoredFindings = [...retained, parsed];
  /*
   * Set aside and reviewed are the same occurrence expressed two ways, and a
   * finding cannot be both. Without this the reviewed-only plan kept carrying a
   * change for a finding the user had just put aside, so Apply would write a
   * correction to something they no longer want mentioned.
   */
  state.reviewedFindings = state.reviewedFindings.filter(
    (item) => !isSameIgnoredOccurrenceIdentity(item, parsed),
  );
  saveState(state);
}

/**
 * Stop ignoring one occurrence.
 *
 * Takes the occurrence key rather than the fingerprint, so restoring one row
 * leaves every other hit of the same rule ignored. A fingerprint here would make
 * Restore all-or-nothing per rule, which is not what the button says it does.
 * An unknown key is a no-op rather than an error: the row may already be gone.
 */
export function restoreFinding(occurrence: string): void {
  const state = loadState();
  // A row whose key was never written matches nothing and matches everything.
  // Comparing it directly would make a single keyless row unreachable by
  // Restore, which is a control that would then silently do nothing — the same
  // failure mode this whole change exists to remove. Keyless rows are matched by
  // fingerprint instead, which is the identity they *do* carry.
  const retained = state.ignoredFindings.filter((item) =>
    item.occurrenceKey.length === 0
      ? occurrence.startsWith(item.fingerprint)
      : item.occurrenceKey !== occurrence,
  );
  if (retained.length === state.ignoredFindings.length) return;
  state.ignoredFindings = retained;
  saveState(state);
}

// ---------------------------------------------------------------------------
// Review decisions
// ---------------------------------------------------------------------------

/** Every review the user has made, newest last. */
export function loadReviewedFindings(): ReviewedFinding[] {
  return loadState().reviewedFindings;
}

/**
 * Record that the user reviewed a finding.
 *
 * Replaces any prior decision for the same occurrence so that re-reviewing after
 * a preview lands does not leave two rows, and so the stored decision always
 * describes the latest thing the user actually did.
 */
export function saveReviewedFinding(entry: ReviewedFinding): void {
  const parsed = ReviewedFindingSchema.parse(entry);
  const state = loadState();
  const retained = state.reviewedFindings.filter((item) => item.identity !== parsed.identity);
  state.reviewedFindings = [...retained, parsed];
  saveState(state);
}

/**
 * Withdraw a review, so the finding can be reviewed again.
 *
 * Also used when a review expires: the occurrence it described no longer exists
 * in the document, so the decision is removed and the user is asked afresh rather
 * than having a stale approval quietly apply to whatever moved into its place.
 */
export function clearReviewedFinding(identity: string): void {
  const state = loadState();
  const retained = state.reviewedFindings.filter((item) => item.identity !== identity);
  if (retained.length === state.reviewedFindings.length) return;
  state.reviewedFindings = retained;
  saveState(state);
}

/**
 * Discard reviews that no longer describe a finding in the current run.
 *
 * Returns the identities that were dropped so the pane can say how many expired
 * rather than letting the list quietly shrink — a review disappearing with no
 * message reads as the tool losing the user's work.
 */
export function pruneStaleReviews(liveIdentities: ReadonlySet<string>): string[] {
  const state = loadState();
  const retained = state.reviewedFindings.filter((item) => liveIdentities.has(item.identity));
  if (retained.length === state.reviewedFindings.length) return [];
  const dropped = state.reviewedFindings
    .filter((item) => !liveIdentities.has(item.identity))
    .map((item) => item.identity);
  state.reviewedFindings = retained;
  saveState(state);
  return dropped;
}
