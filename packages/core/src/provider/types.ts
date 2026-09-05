export type ProviderErrorCode =
  | 'not-configured'
  | 'permission-missing'
  | 'authentication'
  | 'model-not-found'
  | 'rate-limited'
  | 'cancelled'
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
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type TranslationPriority = 'current' | 'prefetch';
export type TranslationProgressStage =
  | 'planning'
  | 'retrying'
  | 'resolving-entities'
  | 'translating'
  | 'repairing-boundaries'
  | 'repairing-output';
