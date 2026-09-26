/**
 * Type declarations for the bundle sentinel verification.
 */

export interface SentinelVariable {
  /** The environment variable the sentinel is injected through. */
  name: string;
  /** The recognizable value that must never appear in a bundle. */
  value: string;
}

export interface SentinelBuild {
  name: string;
  config: string;
  mode: string;
}

export interface SentinelBuildResult {
  build: string;
  built: boolean;
  /** Environment variable names whose sentinel value reached the bundle. */
  leaks: string[];
  output: string;
}

export declare const SENTINEL_VARIABLES: readonly SentinelVariable[];
export declare const BUILDS: readonly SentinelBuild[];

export declare function sentinelEnv(baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;

export declare function findSentinels(text: string): string[];

/**
 * The structural shape `runSentinelBuild` needs from `spawnSync`.
 *
 * Narrower than the real signature on purpose: a test double only has to
 * provide the fields the decision logic reads, and requiring a full
 * `SpawnSyncReturns` would make the logic untestable without a real process.
 */
export interface SpawnLikeResult {
  status: number | null;
  stdout?: string | null;
  /** Diagnostics; both streams are kept so a failure is never reported blank. */
  stderr?: string | null;
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; encoding: "utf8"; shell: false },
) => SpawnLikeResult;

export declare function runSentinelBuild(
  build: SentinelBuild,
  overrides?: { envImpl?: SpawnLike; scan?: SpawnLike },
): SentinelBuildResult;
