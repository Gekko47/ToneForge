export interface UpstreamClassification {
  baseUrl: string;
  classification: "deploymentDefault" | "loopbackDevelopment" | "userApprovedSelfHosted";
}

export interface StoredConnection {
  apiKey: string;
  baseUrl: string;
  classification?: string;
  createdAt?: string;
}

export interface GatewayModelEntry {
  id: string;
  displayName: string;
  description: string;
  contextWindow: number | null;
  inputModalities: string[];
  outputModalities: string[];
  supportsStructuredOutput: boolean;
  supportsTools: boolean;
  supportsReasoning: boolean;
  deprecated: boolean;
}

export declare const OPENROUTER_DEFAULT_BASE_URL: string;
export declare const GATEWAY_PATH_PREFIX: string;
export declare const MAX_BROKER_BODY_BYTES: number;

export declare function classifyUpstreamBaseUrl(value: unknown): UpstreamClassification | null;

export declare function validateChatPayload(body: unknown): { valid: boolean; reason?: string };

export declare function createDevGatewayBroker(options?: {
  fetchImpl?: typeof fetch;
  expectedNonce?: string;
  connections?: Map<string, StoredConnection>;
  now?: () => Date;
}): (req: unknown, res: unknown, next: () => void) => Promise<void>;

export declare function normalizeModelEntry(raw: unknown): GatewayModelEntry | null;

export declare function timingSafeEqual(left: Buffer, right: Buffer): boolean;
