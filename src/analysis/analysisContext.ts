/**
 * Host-neutral analysis context.
 *
 * A context is assembled once by the Word boundary and then consumed by pure
 * analyzers. It deliberately contains DTOs only: no Office objects, ranges, or
 * provider handles cross this boundary.
 */

import type { DocumentNode, DocumentSnapshot } from "../core/domain/DocumentSnapshot";
import type { GovernanceProfile } from "../core/domain/GovernanceProfile";
import type { StyleProfile } from "../core/domain/StyleProfile";
import type { FormattingSnapshot } from "../formatting/formattingSnapshot";

export interface AnalysisCapabilities {
  supportsInsertText: boolean;
  supportsReplaceText: boolean;
  supportsInsertParagraph: boolean;
  supportsInsertBreak: boolean;
  supportsStyles: boolean;
  supportsParagraphFormat: boolean;
  supportsCharacterFormat: boolean;
  supportsResetCharacterFormatting: boolean;
  supportsListLevel: boolean;
  supportsRevisions: boolean;
  supportsSelection: boolean;
  supportsParagraphResolution: boolean;
  supportsHighlight: boolean;
  supportsContextMenu: boolean;
  hostName: "Word" | "Excel" | "PowerPoint" | "unknown";
  hostVersion: string | null;
}

export interface AcquisitionDiagnostics {
  runId: string;
  acquisitionReadCount: number;
  syncCount: number;
  analyzedCharacterCount: number;
  completeDocumentCharacterCount: number;
  fullBodyReadCount: number;
  paragraphCollectionRead: boolean;
  structuralCoverage: "complete" | "partial" | "unsupported";
  unsupported: string[];
  /**
   * Whether acquisition itself examined only part of the document.
   *
   * Widened from the literal `false` for the same reason as the coverage schema:
   * the acquisition adapter always reads the whole body, but a caller that
   * narrows the examined set afterwards reports that through the coverage
   * report, and a type that cannot say `true` pushes that lie back onto whoever
   * builds the diagnostic.
   */
  incremental: boolean;
  incrementalReason: string;
}

export interface AnalysisIdentity {
  documentId: string;
  documentVersion: string;
  contentHash: string;
  structuralHash: string;
  capturedAt: string;
  fullText: string;
  analysisText: string;
  analysisStart: number;
  analysisEnd: number;
  analysisTruncated: boolean;
}

export interface AnalysisContext {
  readonly identity: AnalysisIdentity;
  readonly text: string;
  readonly nodes: readonly DocumentNode[];
  readonly snapshot: DocumentSnapshot;
  readonly formatting: FormattingSnapshot;
  readonly profile: StyleProfile;
  readonly capabilities: AnalysisCapabilities;
  readonly policy: GovernanceProfile;
  readonly acquisition: AcquisitionDiagnostics;
}

export function createAnalysisContext(input: {
  snapshot: DocumentSnapshot;
  formatting: FormattingSnapshot;
  profile: StyleProfile;
  policy: GovernanceProfile;
  capabilities: AnalysisCapabilities;
  acquisition: AcquisitionDiagnostics;
}): AnalysisContext {
  const snapshot = input.snapshot;
  const identity: AnalysisIdentity = {
    documentId: snapshot.documentId,
    documentVersion: snapshot.versionToken,
    contentHash: snapshot.contentHash,
    structuralHash: snapshot.structuralHash,
    capturedAt: snapshot.capturedAt,
    fullText: snapshot.fullText ?? "",
    analysisText: snapshot.analysisText ?? snapshot.fullText ?? "",
    analysisStart: snapshot.analysisStart ?? 0,
    analysisEnd: snapshot.analysisEnd ?? (snapshot.analysisText ?? snapshot.fullText ?? "").length,
    analysisTruncated: snapshot.analysisTruncated ?? false,
  };
  return deepFreeze({
    identity,
    text: identity.analysisText,
    nodes: snapshot.nodes,
    snapshot,
    formatting: input.formatting,
    profile: input.profile,
    capabilities: input.capabilities,
    policy: input.policy,
    acquisition: input.acquisition,
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((child) => deepFreeze(child));
  }
  return value;
}
