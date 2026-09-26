export interface ManifestValidationOptions {
  manifestPath?: string;
  xmlManifestPath?: string;
  commandDefinitionsPath?: string;
  manifest?: unknown;
  xml?: string;
  runOfficialValidator?: boolean;
}
export function validateManifests(options?: ManifestValidationOptions): Promise<string[]>;
