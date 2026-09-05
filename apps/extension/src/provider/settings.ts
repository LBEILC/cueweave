import type { ProviderSettings } from '@cueweave/core/provider/types';
import { normalizeBaseUrl, parseProviderSettings } from '@cueweave/core/provider/settings';
export {
  DEFAULT_PROVIDER_SETTINGS,
  normalizeBaseUrl,
  parseProviderSettings,
} from '@cueweave/core/provider/settings';

export const PROVIDER_SETTINGS_KEY = 'cueweave.provider';

export async function readProviderSettings(): Promise<ProviderSettings> {
  const stored = await browser.storage.local.get([PROVIDER_SETTINGS_KEY]);
  return parseProviderSettings(stored[PROVIDER_SETTINGS_KEY]);
}

export async function saveProviderSettings(settings: ProviderSettings): Promise<void> {
  await browser.storage.local.set({
    [PROVIDER_SETTINGS_KEY]: {
      baseUrl: normalizeBaseUrl(settings.baseUrl),
      apiKey: settings.apiKey.trim(),
      model: settings.model.trim(),
      protocol: settings.protocol,
    },
  });
}

export function providerOriginPattern(baseUrl: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  return `${url.origin}/*`;
}
