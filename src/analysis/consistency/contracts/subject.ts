import { z } from "zod";

/**
 * The concrete DecisionSubject union (D12).
 *
 * A subject is what two claims are *about*. Retrieval pairs claims that share
 * a subject; the deterministic resolver compares them; the decision model is
 * asked only about pairs no resolver could settle. C8 and C9 use reference
 * and section subjects, not forced pairs — a citation and its target are one
 * subject, a heading promise and its section are one subject.
 */
export const DecisionSubjectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("entity"),
    /** Canonical entity name, after alias resolution. */
    name: z.string().trim().min(1),
    aliases: z.array(z.string()).default([]),
  }),
  z.object({
    kind: z.literal("event"),
    /** Canonical event description. */
    description: z.string().trim().min(1),
    temporal: z.string().optional(),
  }),
  z.object({
    kind: z.literal("programme"),
    identifier: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("quantum"),
    /** What is being measured, in canonical units. */
    measure: z.string().trim().min(1),
    unit: z.string().default(""),
  }),
  z.object({
    kind: z.literal("reference"),
    /** The citation as written. */
    citation: z.string().trim().min(1),
    /** The section or claim it points at, when resolved. */
    target: z.string().optional(),
  }),
  z.object({
    kind: z.literal("section"),
    /** The heading whose promise is under review. */
    heading: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("term"),
    /** The defined term, in canonical form. */
    term: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("unknown"),
    /** Why no subject could be assigned. Counted, never silently dropped. */
    reason: z.string().default(""),
  }),
]);

export type DecisionSubject = z.infer<typeof DecisionSubjectSchema>;
