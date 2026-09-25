export const VERIFICATION_GRAPH_NAME: string;
export const VERIFICATION_GRAPH: ReadonlyArray<{
  readonly name: string;
  readonly command: string;
}>;
export function runVerificationGraph(
  stages?: ReadonlyArray<{ readonly name: string; readonly command: string }>,
): void;
