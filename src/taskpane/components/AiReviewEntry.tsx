/**
 * AiReviewEntry — visible entry points for consent-gated semantic review.
 *
 * Phase C only provides navigation and prerequisite states. It does not send
 * document text to an LLM and does not mutate Word.
 */

import React from "react";

export interface AiReviewEntryProps {
  supportsSelection: boolean;
  supportsParagraphResolution: boolean;
  hasSelection: boolean;
  providerConfigured: boolean;
  hasConsent: boolean;
  hasFullDocumentConsent: boolean;
  onReviewSelection: () => void;
  onReviewParagraph: () => void;
  onReviewDocument: () => void;
  onOpenSettings: () => void;
}

export default function AiReviewEntry({
  supportsSelection,
  supportsParagraphResolution,
  hasSelection,
  providerConfigured,
  hasConsent,
  hasFullDocumentConsent,
  onReviewSelection,
  onReviewParagraph,
  onReviewDocument,
  onOpenSettings,
}: AiReviewEntryProps): React.ReactNode {
  const selectionDisabled =
    !providerConfigured || !hasConsent || !supportsSelection || !hasSelection;
  const paragraphDisabled = !providerConfigured || !hasConsent || !supportsParagraphResolution;
  const documentDisabled = !providerConfigured || !hasFullDocumentConsent;

  function explain(
    disabled: boolean,
    configured: boolean,
    consent: boolean,
    capability: boolean,
    text: string,
  ): string | null {
    if (!configured) return "Configure an AI provider in Settings first.";
    if (!consent) return "Give explicit consent before document text can be reviewed by AI.";
    if (!capability) return "This Word host does not expose the required review capability.";
    return disabled && text ? text : null;
  }

  const selectionMessage = explain(
    selectionDisabled,
    providerConfigured,
    hasConsent,
    supportsSelection && hasSelection,
    "Select text in Word before reviewing the selection.",
  );
  const paragraphMessage = explain(
    paragraphDisabled,
    providerConfigured,
    hasConsent,
    supportsParagraphResolution,
    "Place the cursor in a paragraph before reviewing it.",
  );
  const documentMessage = explain(
    documentDisabled,
    providerConfigured,
    hasFullDocumentConsent,
    true,
    "",
  );

  return (
    <section aria-label="AI Review" style={{ marginTop: "1.5rem" }}>
      <h2>AI Review</h2>
      <p>AI review is optional. Deterministic checks do not send document text externally.</p>
      {!providerConfigured && (
        <div role="status">
          <p>No AI provider is configured. Deterministic review remains available.</p>
          <button type="button" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={onReviewSelection}
          disabled={selectionDisabled}
          aria-describedby={selectionMessage ? "selection-review-hint" : undefined}
        >
          Review selection
        </button>
        <button
          type="button"
          onClick={onReviewParagraph}
          disabled={paragraphDisabled}
          aria-describedby={paragraphMessage ? "paragraph-review-hint" : undefined}
        >
          Review paragraph
        </button>
        <button
          type="button"
          onClick={onReviewDocument}
          disabled={documentDisabled}
          aria-describedby={documentMessage ? "document-review-hint" : undefined}
        >
          Review entire document
        </button>
      </div>
      {selectionMessage && (
        <p id="selection-review-hint" style={{ fontSize: "0.85rem" }}>
          {selectionMessage}
        </p>
      )}
      {paragraphMessage && (
        <p id="paragraph-review-hint" style={{ fontSize: "0.85rem" }}>
          {paragraphMessage}
        </p>
      )}
      {documentMessage && (
        <p id="document-review-hint" style={{ fontSize: "0.85rem" }}>
          {documentMessage}
        </p>
      )}
    </section>
  );
}
