import { z } from "zod";

/**
 * The document the engine reviews.
 *
 * `revision` is the document's content hash, not its length. An edit that
 * replaces a word with another of the same length leaves the length identical,
 * and a guard keyed on length would report such a run as still current — which
 * is the exact edit the staleness guard exists to catch.
 *
 * `sections` is the list of heading titles in document order. Headings are
 * carried into the run text as Markdown markers, and the engine reads section
 * identity from those markers rather than guessing at a style name.
 */
export const ConsistencyDocumentSchema = z.object({
  revision: z.string().trim().min(1),
  text: z.string(),
  sections: z.array(z.string()),
});

export type ConsistencyDocument = z.infer<typeof ConsistencyDocumentSchema>;

/**
 * The request shape the UI sends.
 *
 * `consistencyConsent` is `z.literal(true)` on purpose: a stored `"yes"` or an
 * absent field must not read as permission. `parseConsistencyReviewRequest`
 * throws on anything else, so the engine's own gate is fail-closed (ADR-0052).
 *
 * `checks` defaults to all ten when an empty array is supplied, so a UI that
 * forgets to pass a selection still runs the full set rather than silently
 * running nothing.
 */
export const ConsistencyReviewRequestSchema = z.object({
  consistencyConsent: z.literal(true),
  document: ConsistencyDocumentSchema,
  model: z.string().default(""),
  checks: z.array(z.string()).default([]),
  maxPerSubject: z.number().int().min(1).max(2000).default(400),
  maxAdjudications: z.number().int().min(1).max(500).default(60),
  /** When true, exact statement text is sent to the provider (D13 opt-out). */
  allowUnredacted: z.boolean().default(false),
});

export type ConsistencyReviewRequest = z.infer<typeof ConsistencyReviewRequestSchema>;
