import type { DevelopmentArtifact } from "./production-manifest.mjs";

export interface ReleasePackageResult {
  readonly staging: string;
  readonly requiredFiles: readonly string[];
  /** Every page the staged manifest names, each one bundle-checked. */
  readonly pages: readonly string[];
  readonly javascriptCount: number;
  readonly referencedBundles: readonly string[];
}

export interface ProductionManifestCheckResult {
  readonly productionOrigin: string;
  readonly developmentArtifacts: readonly DevelopmentArtifact[];
}

export function checkReleasePackage(staging?: string): ReleasePackageResult;

export function checkProductionManifest(
  manifest: unknown,
  productionOrigin: string,
): ProductionManifestCheckResult;
