/**
 * Type declarations for the canonical verification graph.
 *
 * The summary's shape is a contract: CI, release tooling, and the host-matrix
 * dashboard all read it. Declaring it here means a change to the emitted
 * fields is a type error in the consumers rather than a silent `undefined` at
 * runtime.
 */

/**
 * Where a stage's failure lives. A `repository-code` failure is ours to fix;
 * `dependency-install` usually means the registry or lockfile moved;
 * `build-package` is about producing and inspecting artifacts; and
 * `external-evidence` is a human gate no automated run can satisfy.
 */
export type StageOwner =
  "repository-code" | "dependency-install" | "build-package" | "external-evidence";

export type StageStatus = "passed" | "failed" | "pending";

export interface VerificationGraphStage {
  readonly name: string;
  readonly command: string;
}

export interface VerificationStageResult {
  name: string;
  /** null for a gate that is recorded but never executed. */
  command: string | null;
  owner: StageOwner;
  status: StageStatus;
  note?: string;
}

export interface VerificationSummary {
  graph: string;
  version: number;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  stages: VerificationStageResult[];
  failureOwners: StageOwner[];
  openExternalGates: string[];
}

export declare const VERIFICATION_GRAPH_NAME: string;
export declare const VERIFICATION_GRAPH: readonly VerificationGraphStage[];
export declare const EXTERNAL_EVIDENCE_STAGE: Readonly<{
  name: string;
  command: null;
  owner: StageOwner;
}>;
export declare const VERIFICATION_SUMMARY_PATH: string;
export declare const STAGE_OWNERSHIP: Readonly<Record<StageOwner, StageOwner>>;

export declare function buildVerificationSummary(input: {
  results: Record<string, boolean>;
  startedAt: string;
  finishedAt: string;
}): VerificationSummary;

export declare function runVerificationGraph(stages?: readonly VerificationGraphStage[]): void;
