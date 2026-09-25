import { v4 as uuidv4 } from "uuid";
import {
  createEmptyProfile,
  StyleProfileSchema,
  type StyleProfile,
} from "../core/domain/StyleProfile";
import { computeMeasuredProfile } from "./metrics";
import { evaluateSampleQuality, type SampleQuality } from "./sampleQuality";
import { buildStyleProfile } from "./profiler";
import type { CapturedSample } from "./sampleCapture";
import type { LlmSemanticProvider } from "../ai/providers/LlmProvider";

export interface LearnStyleOptions {
  name?: string;
  /** Semantic interpretation requires explicit raw-text consent. */
  includeSemantic?: boolean;
  registry?: LlmSemanticProvider;
  signal?: AbortSignal;
  constraints?: string[];
}

export interface LearnStyleEvidence {
  sampleId: string;
  source: CapturedSample["source"];
  wordCount: number;
  sentenceCount: number;
  pass: boolean;
  reasons: string[];
  measured: StyleProfile["measured"];
  semanticIncluded: boolean;
}

export interface LearnStyleResult {
  draft: StyleProfile;
  evidence: LearnStyleEvidence;
}

function evidenceFrom(
  sample: CapturedSample,
  quality: SampleQuality,
  sampleId: string,
  measured: StyleProfile["measured"],
  semanticIncluded: boolean,
): LearnStyleEvidence {
  return {
    sampleId,
    source: sample.source,
    wordCount: quality.wordCount,
    sentenceCount: quality.sentenceCount,
    pass: quality.pass,
    reasons: quality.reasons,
    measured,
    semanticIncluded,
  };
}

/**
 * Build an editable, versioned draft from a captured sample.
 *
 * Deterministic evidence is always produced. Semantic interpretation is only
 * attempted when the caller explicitly opts in; the prompt layer enforces the
 * raw-text gate again before any provider call.
 */
export async function learnStyleDraft(
  sample: CapturedSample,
  options: LearnStyleOptions = {},
): Promise<LearnStyleResult> {
  const quality = evaluateSampleQuality(sample);
  if (!quality.pass) {
    throw new Error(`Sample is not suitable for style learning: ${quality.reasons.join(" ")}`);
  }

  const sampleId = uuidv4();
  const measured = computeMeasuredProfile(sample.text);
  const name = options.name ?? "Learned style profile";
  const semanticIncluded = options.includeSemantic === true;
  const base = createEmptyProfile(name);
  const draft = semanticIncluded
    ? await buildStyleProfile(sample, {
        includeRawText: true,
        name,
        ...(options.registry ? { registry: options.registry } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.constraints ? { constraints: options.constraints } : {}),
      })
    : { ...base, measured };

  const normalized = StyleProfileSchema.parse({
    ...draft,
    id: base.id,
    name,
    measured: draft.measured ?? measured,
    sourceSampleIds: [sampleId],
  });

  return {
    draft: normalized,
    evidence: evidenceFrom(sample, quality, sampleId, normalized.measured, semanticIncluded),
  };
}
