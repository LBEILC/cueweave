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
  it.each(['chat-completions', 'responses'] as const)(
    'preserves network errors for %s without credentials',
    async (protocol) => {
      const error = await testProviderConnection(
        { ...settings, protocol },
        {
          fetch: async () => {
            throw new TypeError(`Failed to fetch ${settings.apiKey}`, {
              cause: new Error('connection refused'),
            });
          },
        },
      ).catch((error: ProviderError) => error);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ code: 'network' });
      const details = (error as ProviderError).details!;
      expect(details).toContain('TypeError: Failed to fetch');
      expect(details).toContain('connection refused');
      expect(details).toContain(protocol === 'responses' ? '/responses' : '/chat/completions');
      expect(details).not.toContain(settings.apiKey);
    },
  );

  it('preserves HTTP errors and both automatic protocol attempts', async () => {
    const error = await testProviderConnection(
      { ...settings, protocol: 'auto' },
      {
        fetch: vi
          .fn()
          .mockResolvedValueOnce(new Response('Unknown endpoint', { status: 404 }))
          .mockResolvedValueOnce(
            new Response(`Invalid Bearer ${settings.apiKey}`, { status: 401 }),
          ),
      },
    ).catch((error: ProviderError) => error);
    const details = (error as ProviderError).details!;
    expect(details).toContain('HTTP: 404');
    expect(details).toContain('HTTP: 401');
    expect(details).toContain('Unknown endpoint');
    expect(details).not.toContain(settings.apiKey);
    expect(error).toMatchObject({ code: 'authentication' });
  });

  it('includes permission errors without sending a request', async () => {
    const request = vi.fn();
    const error = await testProviderConnection(settings, {
      fetch: request,
      assertPermission: async () => {
        throw new ProviderError('permission-missing', 'Access denied');
      },
    }).catch((error: ProviderError) => error);
    expect((error as ProviderError).details).toContain('permission-missing');
    expect(request).not.toHaveBeenCalled();
  });
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
