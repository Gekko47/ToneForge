import { runInWord } from "../shared/office/officeHelpers";
import { logger } from "../shared/utils/logger";
import {
  assessCapabilityEvidence,
  paragraphEventRequirementMet,
  type CapabilityEvidence,
} from "./capabilityEvidence";

export type WordParagraphChangeKind = "added" | "changed" | "deleted";

export interface WordParagraphChange {
  kind: WordParagraphChangeKind;
  uniqueLocalIds: string[];
  source: "local" | "remote" | "unknown";
  requiresFullRescan: boolean;
  at: string;
}

interface EventRegistration {
  remove: () => void;
}

interface ParagraphEventArgs {
  uniqueLocalIds?: unknown;
  source?: unknown;
}

interface ParagraphEventSource {
  add: (handler: (event: ParagraphEventArgs) => void) => EventRegistration;
}

interface EventCapableDocument {
  onParagraphAdded?: ParagraphEventSource;
  onParagraphChanged?: ParagraphEventSource;
  onParagraphDeleted?: ParagraphEventSource;
  requirementSets?: unknown;
}

export interface WordParagraphEventAdapterOptions {
  onChange: (change: WordParagraphChange) => void;
  onError?: (error: unknown) => void;
  now?: () => string;
}

export interface WordParagraphEventAdapter {
  start: () => Promise<boolean>;
  stop: () => void;
  isRegistered: () => boolean;
  lastError: () => string | null;
}

function normalizeLocalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSource(value: unknown): WordParagraphChange["source"] {
  return value === "local" || value === "remote" ? value : "unknown";
}

export function normalizeParagraphEvent(
  kind: WordParagraphChangeKind,
  event: ParagraphEventArgs,
  now: string,
): WordParagraphChange {
  const raw = Array.isArray(event.uniqueLocalIds) ? event.uniqueLocalIds : [];
  const uniqueLocalIds = [
    ...new Set(raw.map(normalizeLocalId).filter((id): id is string => id !== null)),
  ];
  return {
    kind,
    uniqueLocalIds,
    source: normalizeSource(event.source),
    requiresFullRescan: uniqueLocalIds.length !== raw.length,
    at: now,
  };
}

function buildHandler(
  kind: WordParagraphChangeKind,
  onChange: (change: WordParagraphChange) => void,
  now: () => string,
): (event: ParagraphEventArgs) => void {
  return (event: ParagraphEventArgs) => {
    onChange(normalizeParagraphEvent(kind, event, now()));
  };
}

/**
 * Register Word paragraph added/changed/deleted events through the Word
 * boundary. Hosts without WordApi 1.6 events return false and the caller keeps
 * the conservative full-rescan observer path.
 */
export function createWordParagraphEventAdapter(
  options: WordParagraphEventAdapterOptions,
): WordParagraphEventAdapter {
  const now = options.now ?? (() => new Date().toISOString());
  const registrations: EventRegistration[] = [];
  let registered = false;
  let lastError: string | null = null;

  async function start(): Promise<boolean> {
    if (registered) return true;
    try {
      registered = await runInWord(async (context) => {
        const document = (context as unknown as { document: EventCapableDocument }).document;
        const sources: readonly [WordParagraphChangeKind, ParagraphEventSource | undefined][] = [
          ["added", document.onParagraphAdded],
          ["changed", document.onParagraphChanged],
          ["deleted", document.onParagraphDeleted],
        ];
        const present = sources.filter(([, source]) => source !== undefined);
        if (present.length === 0) {
          lastError = "This Word host does not expose paragraph events (WordApi 1.6).";
          return false;
        }
        present.forEach(([kind, source]) => {
          const registration = source?.add(buildHandler(kind, options.onChange, now));
          if (registration) registrations.push(registration);
        });
        await context.sync();
        return registrations.length > 0;
      });
      return registered;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
      options.onError?.(error);
      logger.warn("Word paragraph event registration failed; using conservative rescan", {
        error: lastError,
      });
      return false;
    }
  }

  function stop(): void {
    while (registrations.length > 0) {
      const registration = registrations.pop();
      try {
        registration?.remove();
      } catch (error: unknown) {
        logger.warn("Word paragraph event deregistration failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    registered = false;
  }

  return {
    start,
    stop,
    isRegistered: () => registered,
    lastError: () => lastError,
  };
}

export function paragraphEventEvidence(input: {
  apiPresent: boolean;
  requirementSet: string | null;
  hostTested: boolean;
  releaseSupported: boolean;
}): CapabilityEvidence {
  return assessCapabilityEvidence({
    capability: "paragraphEvents",
    apiPresent: input.apiPresent && paragraphEventRequirementMet(input.requirementSet),
    hostTested: input.hostTested,
    releaseSupported: input.releaseSupported,
  });
}
