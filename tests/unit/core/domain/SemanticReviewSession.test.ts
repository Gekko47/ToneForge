/**
 * The semantic session and its persisted outcome log.
 *
 * The load-bearing tests here are the reflection ones. A schema field that can
 * hold document text is a leak that ships; a schema field that can hold a
 * document fingerprint is a smaller leak with the same property. Both are
 * checked by walking the schema's own shape rather than by reading the type,
 * because a type annotation is a promise and the parsed shape is the fact.
 */

import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  appendSemanticOutcome,
  SEMANTIC_REVIEW_OUTCOME_CAP,
  SEMANTIC_SAMPLE_SOURCES,
  SemanticReviewOutcomeSchema,
  SemanticSampleEvidenceSchema,
  type SemanticReviewOutcome,
  type SemanticSampleEvidence,
} from "../../../../src/core/domain/SemanticReviewSession";

const NOW = "2026-01-01T00:00:00.000Z";
const SESSION_ID = "3f1b0c6e-6a54-4b1e-9c2a-0d1e2f3a4b5c";
const PROFILE_ID = "9a2c7e14-52b8-4c3d-8e1f-2b6d4a8f0c31";

function outcome(overrides: Partial<SemanticReviewOutcome> = {}): SemanticReviewOutcome {
  return SemanticReviewOutcomeSchema.parse({
    sessionId: SESSION_ID,
    profileId: PROFILE_ID,
    profileRevision: 3,
    outcome: "applied",
    at: NOW,
    preservationPassed: true,
    selectionWordCount: 186,
    ...overrides,
  });
}

function evidence(overrides: Partial<SemanticSampleEvidence> = {}): SemanticSampleEvidence {
  return SemanticSampleEvidenceSchema.parse({
    id: "5d3f8b21-7c4a-4e19-9b62-8f1a3c5d7e02",
    source: "pasted_text",
    wordCount: 412,
    sentenceCount: 19,
    paragraphCount: 6,
    capturedAt: NOW,
    sampleHash: "a1b2c3d4",
    ...overrides,
  });
}

/** Every leaf reachable from a schema, as dotted paths. */
function leafPaths(schema: z.ZodTypeAny, prefix = ""): string[] {
  const inner = (schema as unknown as { _def: { innerType?: z.ZodTypeAny; typeName?: string } })
    ._def;
  if (inner?.typeName === "ZodObject" || inner?.typeName === "ZodRecord") {
    const shape = (schema as unknown as { shape?: z.ZodRawShape }).shape;
    if (shape) {
      return Object.entries(shape).flatMap(([key, value]) =>
        leafPaths(value as z.ZodTypeAny, prefix === "" ? key : `${prefix}.${key}`),
      );
    }
  }
  if (inner?.innerType) return leafPaths(inner.innerType, prefix);
  return [prefix];
}

describe("SemanticReviewOutcome", () => {
  it("stores what a user can be told about their own review, and nothing else", () => {
    const paths = leafPaths(SemanticReviewOutcomeSchema).sort();
    expect(paths).toEqual([
      "at",
      "outcome",
      "preservationPassed",
      "profileId",
      "profileRevision",
      "selectionWordCount",
      "sessionId",
    ]);
  });

  it("has no field that could hold document text", () => {
    // A record with `text`, `selectedText`, `original`, or `proposed` would
    // satisfy every stated requirement in the specification while storing a copy
    // of the user's writing in `Office.roamingSettings`.
    const names = Object.keys(SemanticReviewOutcomeSchema.shape).map((name) => name.toLowerCase());
    ["text", "content", "original", "proposed", "excerpt", "body", "selection"].forEach(
      (forbidden) => {
        expect(names).not.toContain(forbidden);
      },
    );
  });

  it("has no field that could fingerprint which document was reviewed", () => {
    // An earlier draft carried `documentId` and `documentHash`. Together those are
    // a durable record of which document a user ran a model against, retained for
    // twenty entries, for a history surface that does not exist.
    const names = Object.keys(SemanticReviewOutcomeSchema.shape).map((name) => name.toLowerCase());
    ["documentid", "documenthash", "document", "hash", "file", "filename", "path"].forEach(
      (forbidden) => {
        expect(names).not.toContain(forbidden);
      },
    );
  });

  it("refuses a revision of zero, which no profile ever has", () => {
    // Built raw rather than through `outcome()`, which parses — a helper that
    // validates cannot be used to assert that validation fails.
    expect(
      SemanticReviewOutcomeSchema.safeParse({
        sessionId: SESSION_ID,
        profileId: PROFILE_ID,
        profileRevision: 0,
        outcome: "applied",
        at: NOW,
        preservationPassed: true,
        selectionWordCount: 186,
      }).success,
    ).toBe(false);
  });
});

describe("SemanticSampleEvidence", () => {
  it("records provenance and counts, and has no field for the sample", () => {
    const names = Object.keys(SemanticSampleEvidenceSchema.shape).map((name) => name.toLowerCase());
    expect(names).toContain("samplehash");
    expect(names).not.toContain("text");
    expect(names).not.toContain("content");
    expect(names).not.toContain("body");
  });

  it("keeps a file's name but never its path", () => {
    // The name is the difference between "learned from expert-report.txt" and
    // "learned from text you pasted". The path is the user's directory layout,
    // which no evidence claim needs and no store should hold.
    expect(evidence({ source: "text_file", filename: "expert-report.txt" }).filename).toBe(
      "expert-report.txt",
    );
    const names = Object.keys(SemanticSampleEvidenceSchema.shape);
    expect(names).not.toContain("path");
    expect(names).not.toContain("directory");
  });

  it("names four sources and no others", () => {
    expect(SEMANTIC_SAMPLE_SOURCES).toEqual([
      "pasted_text",
      "text_file",
      "word_selection",
      "word_document",
    ]);
    // The pre-v14 value. A store written by an older build carries it, and it has
    // to fail rather than be silently accepted as one of the four.
    expect(
      SemanticSampleEvidenceSchema.safeParse({ ...evidence(), source: "pasted" }).success,
    ).toBe(false);
  });
});

describe("appendSemanticOutcome", () => {
  it("keeps one row per session, so a regenerated review is not three reviews", () => {
    let entries: SemanticReviewOutcome[] = [];
    entries = appendSemanticOutcome(entries, outcome({ outcome: "regenerated" }));
    entries = appendSemanticOutcome(
      entries,
      outcome({ outcome: "applied", at: "2026-01-02T00:00:00.000Z" }),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.outcome).toBe("applied");
  });

  it("caps at the documented retention, newest last", () => {
    let entries: SemanticReviewOutcome[] = [];
    Array.from({ length: SEMANTIC_REVIEW_OUTCOME_CAP + 5 }, (_unused, index) => index).forEach(
      (index) => {
        entries = appendSemanticOutcome(
          entries,
          outcome({
            sessionId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
          }),
        );
      },
    );

    expect(entries).toHaveLength(SEMANTIC_REVIEW_OUTCOME_CAP);
    expect(entries[entries.length - 1]?.at).toBe(
      new Date(Date.UTC(2026, 0, 1, 0, SEMANTIC_REVIEW_OUTCOME_CAP + 4)).toISOString(),
    );
  });

  it("is stable: appending what is already the last entry changes nothing", () => {
    const once = appendSemanticOutcome([], outcome());
    expect(appendSemanticOutcome(once, outcome())).toEqual(once);
  });
});
