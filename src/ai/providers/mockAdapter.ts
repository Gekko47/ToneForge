/**
 * Mock LLM adapter for deterministic tests and offline development.
 * Returns scripted responses keyed by prompt substring.
 */

import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./LlmProvider";

export interface MockAdapterOptions {
  responses?: Record<string, string>;
  defaultResponse?: string;
  latencyMs?: number;
  failOn?: string[];
}

export class MockAdapter implements LlmProvider {
  readonly name = "mock";
  private readonly responses: Record<string, string>;
  private readonly defaultResponse: string;
  private readonly latencyMs: number;
  private readonly failOn: string[];

  constructor(opts: MockAdapterOptions = {}) {
    this.responses = opts.responses ?? {};
    this.defaultResponse = opts.defaultResponse ?? "Mocked response.";
    this.latencyMs = opts.latencyMs ?? 0;
    this.failOn = opts.failOn ?? [];
  }

  get configured(): boolean {
    return true;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
    }

    // Honor caller abort signals so the mock respects the same contract as
    // the live adapters (non-retryable caller abort).
    if (request.signal?.aborted) {
      throw new LlmError("Mock request aborted by caller", this.name, false);
    }

    // Precedence: `failOn` is checked BEFORE `responses`. If the same needle
    // appears in both, failure wins so test expectations about error paths are
    // not silently overridden by a scripted response.
    for (const needle of this.failOn) {
      if (request.prompt.includes(needle)) {
        throw new LlmError(`Mock failure triggered by: ${needle}`, this.name, false);
      }
    }

    for (const [key, value] of Object.entries(this.responses)) {
      if (request.prompt.includes(key)) {
        return { text: value, model: "mock" };
      }
    }

    return { text: this.defaultResponse, model: "mock" };
  }
}
