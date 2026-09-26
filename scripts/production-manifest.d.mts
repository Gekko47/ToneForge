/**
 * Type declarations for production manifest generation.
 */

export interface DevelopmentArtifact {
  /** Dotted path to the offending value, e.g. `extensions[0].runtimes[0].code.page`. */
  path: string;
  value: string;
  reason: string;
}

export interface ProductionManifestOptions {
  productionOrigin: string;
}

export declare const LOOPBACK_HOSTNAMES: readonly string[];
export declare const DEVELOPMENT_PATH_PREFIXES: readonly string[];
export declare const SECRET_SHAPED_PATTERNS: readonly RegExp[];

export declare function validateProductionOrigin(value: unknown): string[];

export declare function findDevelopmentArtifacts(manifest: unknown): DevelopmentArtifact[];

export declare function buildProductionManifest<T>(sourceManifest: T, productionOrigin: string): T;
