export interface ReleasePackageResult {
  readonly staging: string;
  readonly requiredFiles: readonly string[];
  readonly javascriptCount: number;
  readonly referencedBundles: readonly string[];
}
export function checkReleasePackage(staging?: string): ReleasePackageResult;
