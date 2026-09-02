import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceToken } from '../domain/subtitle';
import { testProviderConnection, translateTokenWindow } from './chatCompletions';
import type { ProviderSettings } from './types';

const settings: ProviderSettings = {
  baseUrl: 'https://provider.example/v1',
  apiKey: 'test-only-key',
  model: 'test-model',
  protocol: 'chat-completions',
};

const tokens: SourceToken[] = [
  { id: 'w0', cueId: 'c0', startMs: 0, endMs: 500, text: 'Hello' },
  { id: 'w1', cueId: 'c0', startMs: 500, endMs: 1_000, text: 'world.' },
];

function completion(content: object | string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        { message: { content: typeof content === 'string' ? content : JSON.stringify(content) } },
      ],
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Chat Completions provider', () => {
  it('sends the key only in the background request and maps valid output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      completion({
        units: [
          {
            startIndex: 0,
            endIndex: 1,
            translation: '你好，世界。',
            sentenceEnd: true,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });

    const result = await translateTokenWindow(settings, tokens);

    expect(result[0]?.translation).toBe('你好世界');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-only-key' }),
      }),
    );
  });

  it('retries once when the first structured result is incomplete', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        completion({
          units: [
            {
              startIndex: 0,
              endIndex: 0,
              translation: '你好',
              sentenceEnd: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        completion({
          units: [
            {
              startIndex: 0,
              endIndex: 1,
              translation: '你好，世界。',
              sentenceEnd: true,
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });

    await expect(translateTokenWindow(settings, tokens)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports missing runtime permission before sending a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(false) } });

    await expect(testProviderConnection(settings)).rejects.toMatchObject({
      code: 'permission-missing',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies authentication failures without exposing response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret', { status: 401 })));
    vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });

    await expect(testProviderConnection(settings)).rejects.toMatchObject({
      code: 'authentication',
      message: expect.not.stringContaining('secret'),
    });
  });

  it('uses the Responses endpoint when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    units: [
                      {
                        startIndex: 0,
                        endIndex: 1,
                        translation: '你好世界',
                        sentenceEnd: true,
                      },
                    ],
                  }),
                },
              ],
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });

    await expect(
      translateTokenWindow({ ...settings, protocol: 'responses' }, tokens),
    ).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example/v1/responses',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      store: false,
      text: { format: { type: 'json_schema', name: 'cueweave_subtitles' } },
    });
  });

  it('falls back to Responses for an unsupported auto-detected endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: 'READY' })));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });

    await expect(testProviderConnection({ ...settings, protocol: 'auto' })).resolves.toMatchObject({
      ok: true,
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://provider.example/v1/chat/completions',
      'https://provider.example/v1/responses',
    ]);
  });
});
