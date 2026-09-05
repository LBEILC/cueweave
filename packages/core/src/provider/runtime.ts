import type { ProviderSettings } from './types';

export interface ProviderDiagnostic {
  kind: 'validation-error' | 'fallback' | 'stage' | 'retry';
  message: string;
}

export interface ProviderRuntime {
  fetch?: typeof fetch;
  assertPermission?: (settings: ProviderSettings) => Promise<void>;
  onDiagnostic?: (event: ProviderDiagnostic) => void;
}
