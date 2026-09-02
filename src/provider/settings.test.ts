import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDER_SETTINGS, parseProviderSettings } from './settings';

describe('provider settings', () => {
  it('migrates stored settings without a request protocol to auto detection', () => {
    expect(
      parseProviderSettings({
        baseUrl: 'https://example.com/v1/',
        apiKey: ' key ',
        model: ' model ',
      }),
    ).toEqual({
      baseUrl: 'https://example.com/v1',
      apiKey: 'key',
      model: 'model',
      protocol: 'auto',
    });
  });

  it('rejects unknown protocol values', () => {
    expect(parseProviderSettings({ protocol: 'legacy' }).protocol).toBe(
      DEFAULT_PROVIDER_SETTINGS.protocol,
    );
  });
});
