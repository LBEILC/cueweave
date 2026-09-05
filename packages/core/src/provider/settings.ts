import type { ProviderSettings } from './types';

export const DEFAULT_PROVIDER_SETTINGS: Readonly<ProviderSettings> = {
  baseUrl: 'https://api.gpt.ge/v1',
  apiKey: '',
  model: 'gemini-3.5-flash-lite',
  protocol: 'auto',
};

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, '');
}

export function parseProviderSettings(value: unknown): ProviderSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PROVIDER_SETTINGS };
  const record = value as Record<string, unknown>;

  return {
    baseUrl:
      typeof record.baseUrl === 'string' && record.baseUrl.trim()
        ? normalizeBaseUrl(record.baseUrl)
        : DEFAULT_PROVIDER_SETTINGS.baseUrl,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey.trim() : '',
    model:
      typeof record.model === 'string' && record.model.trim()
        ? record.model.trim()
        : DEFAULT_PROVIDER_SETTINGS.model,
    protocol:
      record.protocol === 'chat-completions' || record.protocol === 'responses'
        ? record.protocol
        : 'auto',
  };
}
