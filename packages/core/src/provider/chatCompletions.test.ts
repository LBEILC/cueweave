import { describe, expect, it, vi } from 'vitest';
import { testProviderConnection, translatePlaybackWindow } from './chatCompletions';
import { ProviderError, type ProviderSettings } from './types';

const settings: ProviderSettings = {
  baseUrl: 'https://provider.example/v1',
  apiKey: 'test-only',
  model: 'test-model',
  protocol: 'chat-completions',
};

function completion(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content } }],
    }),
  );
}

describe('provider runtime adapters', () => {
  it('translates and preserves source timing in a Node runtime without extension globals', async () => {
    const request = vi.fn().mockResolvedValue(
      completion(
        JSON.stringify({
          units: [{ startIndex: 0, endIndex: 1, translation: '你好世界', sentenceEnd: true }],
          corrections: [],
          terminology: [],
        }),
      ),
    );
    const cues = await translatePlaybackWindow(
      settings,
      [
        { id: 'a', cueId: 'greeting', text: 'Hello', startMs: 1250, endMs: 1800 },
        { id: 'b', cueId: 'greeting', text: 'world.', startMs: 1800, endMs: 2600 },
      ],
      undefined,
      undefined,
      undefined,
      undefined,
      { fetch: request },
    );
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({
      translation: '你好世界',
      startMs: 1250,
      endMs: 2600,
      sourceTokenIds: ['a', 'b'],
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('passes connection tests through the supplied runtime', async () => {
    const request = vi.fn().mockResolvedValue(completion('READY'));
    const permission = vi.fn().mockResolvedValue(undefined);
    await expect(
      testProviderConnection(settings, {
        fetch: request,
        assertPermission: permission,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(permission).toHaveBeenCalledWith(settings);
    expect(request).toHaveBeenCalledOnce();
  });

  it('never sends a request when the host rejects access', async () => {
    const request = vi.fn();
    await expect(
      testProviderConnection(settings, {
        fetch: request,
        assertPermission: async () => {
          throw new ProviderError('permission-missing', 'Denied');
        },
      }),
    ).rejects.toMatchObject({ code: 'permission-missing' });
    expect(request).not.toHaveBeenCalled();
  });
});
