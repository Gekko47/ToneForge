export const BROKER_PATH: string;
export const MAX_BROKER_BODY_BYTES: number;
export function isLocalBrokerUrl(value: string): boolean;
export function validateBrokerOrigin(headers?: Record<string, string>): {
  allowed: boolean;
  reason?: string;
};
export function validateSessionNonce(
  headers?: Record<string, string>,
  expectedNonce?: string,
): boolean;
export function validateBrokerPayload(body: unknown): { valid: boolean; reason?: string };
export function readJsonBody(req: AsyncIterable<unknown>, maxBytes?: number): Promise<unknown>;
export function createLocalLlmBroker(options?: {
  fetchImpl?: typeof fetch;
  expectedNonce?: string;
  getApiKey?: () => string | undefined;
  getUpstreamBase?: () => string;
}): (req: unknown, res: unknown, next: () => void) => Promise<void>;
