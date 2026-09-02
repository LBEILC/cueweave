export type ProviderErrorCode =
  | 'not-configured'
  | 'permission-missing'
  | 'authentication'
  | 'model-not-found'
  | 'rate-limited'
  | 'timeout'
  | 'network'
  | 'invalid-response';

export interface ProviderSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  protocol: ProviderProtocol;
}

export type ProviderProtocol = 'auto' | 'chat-completions' | 'responses';

export interface ProviderTestResult {
  ok: boolean;
  message: string;
}

export interface ProviderFailure {
  code: ProviderErrorCode;
  message: string;
}

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
