import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceToken } from '../domain/subtitle';
import {
  resolveVideoEntityAliases,
  testProviderConnection,
  translateTokenWindow,
} from './chatCompletions';
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
  it('keeps a model-returned version dot without starting a repair request', async () => {
    const versionTokens = 'Version 5.6 is ready.'.split(' ').map((text, index) => ({
      id: `version-${index}`,
      cueId: 'version-cue',
      startMs: index * 250,
      endMs: (index + 1) * 250,
      text,
    }));
    const fetchMock = vi.fn().mockResolvedValue(
      completion({
        units: [
          { startIndex: 0, endIndex: 3, translation: '5.6版本已准备好。', sentenceEnd: true },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });
    const progress: string[] = [];

    const cues = await translateTokenWindow(settings, versionTokens, (stage) =>
      progress.push(stage),
    );

    expect(cues[0]?.translation).toBe('5.6版本已准备好');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(progress).toEqual(['translating']);
  });

  it('resolves video-wide entity variants with a dedicated structured request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      completion({
        clusters: [
          {
            canonical: 'ChatGPT',
            aliases: ['chat GBT', 'CHBT', 'JPT'],
            confidence: 0.97,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });

    const result = await resolveVideoEntityAliases(settings, [
      { observed: 'chat GBT', count: 2, contexts: ['before chat GBT'] },
      { observed: 'CHBT', count: 3, contexts: ['CHBT just hit a billion users'] },
      { observed: 'JPT', count: 1, contexts: ['AI is still just JPT'] },
    ]);

    expect(result).toContainEqual({ source: 'CHBT', translation: 'ChatGPT' });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      response_format?: { json_schema?: { name?: string } };
    };
    expect(request.response_format?.json_schema?.name).toBe('cueweave_entity_aliases');
  });

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

  it('asks the model to replace punctuation-separated clauses with exact semantic units', async () => {
    const longTokens =
      'We reviewed many samples and found this behavior was unexpected even though it looked fine alone.'
        .split(' ')
        .map((text, index) => ({
          id: `long-${index}`,
          cueId: 'long-cue',
          startMs: index * 200,
          endMs: (index + 1) * 200,
          text,
        }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        completion({
          units: [
            {
              startIndex: 0,
              endIndex: 15,
              translation: '我们阅读了大量样本后发现，这种行为与预期不一致，尽管单独看来没有问题',
              sentenceEnd: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        completion({
          units: [
            {
              startIndex: 0,
              endIndex: 5,
              translation: '我们阅读大量样本后发现',
              sentenceEnd: false,
            },
            {
              startIndex: 6,
              endIndex: 9,
              translation: '这种行为与预期不一致',
              sentenceEnd: false,
            },
            {
              startIndex: 10,
              endIndex: 15,
              translation: '尽管单独看来没有问题',
              sentenceEnd: true,
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });

    const progress: string[] = [];
    const result = await translateTokenWindow(settings, longTokens, (stage) => {
      progress.push(stage);
    });

    expect(result.map((cue) => cue.translation)).toEqual([
      '我们阅读大量样本后发现',
      '这种行为与预期不一致',
      '尽管单独看来没有问题',
    ]);
    expect(result.flatMap((cue) => cue.sourceTokenIds)).toEqual(
      longTokens.map((token) => token.id),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const repairRequest = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body),
    ) as { messages: Array<{ role: string; content: string }> };
    expect(repairRequest.messages).toHaveLength(2);
    expect(repairRequest.messages.at(-1)?.content).toContain('不按字符数机械切分');
    expect(repairRequest.messages.at(-1)?.content).toContain('分句标点');
    expect(repairRequest.messages.at(-1)?.content).toContain('targetTokens');
    expect(repairRequest.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(progress).toEqual(['translating', 'repairing-boundaries']);
  });

  it('reconsiders adjacent units when the first boundary repair is still invalid', async () => {
    const recursiveTokens = 'And I think a kind of cleareyed sober response where it is like hey.'
      .split(' ')
      .map((text, index) => ({
        id: `recursive-${index}`,
        cueId: 'recursive-cue',
        startMs: index * 200,
        endMs: (index + 1) * 200,
        text,
      }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        completion({
          units: [
            {
              startIndex: 0,
              endIndex: 13,
              translation: '我认为一种清醒而理智的回应是，就像这样说嘿',
              sentenceEnd: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        completion({
          units: [
            {
              startIndex: 0,
              endIndex: 7,
              translation: '我认为应该保持清醒理智',
              sentenceEnd: false,
            },
            {
              startIndex: 8,
              endIndex: 13,
              translation: '回应就像是，接着说嘿',
              sentenceEnd: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        completion({
          units: [
            {
              startIndex: 0,
              endIndex: 7,
              translation: '我认为应该保持清醒理智',
              sentenceEnd: false,
            },
            {
              startIndex: 8,
              endIndex: 11,
              translation: '回应就像是',
              sentenceEnd: false,
            },
            {
              startIndex: 12,
              endIndex: 13,
              translation: '这样说嘿',
              sentenceEnd: true,
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });
    const progress: string[] = [];

    const result = await translateTokenWindow(settings, recursiveTokens, (stage) => {
      progress.push(stage);
    });

    expect(result.map((cue) => cue.translation)).toEqual([
      '我认为应该保持清醒理智',
      '回应就像是',
      '这样说嘿',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const lastRequest = JSON.parse(
      String((fetchMock.mock.calls[2]?.[1] as RequestInit | undefined)?.body),
    ) as { messages: Array<{ content: string }> };
    expect(lastRequest.messages.at(-1)?.content).toContain('"startIndex":0');
    expect(lastRequest.messages.at(-1)?.content).toContain(
      '"currentTranslation":"我认为应该保持清醒理智 / 回应就像是，接着说嘿"',
    );
    expect(progress).toEqual(['translating', 'repairing-boundaries', 'repairing-boundaries']);
  });

  it('keeps precise model ranges after bounded repairs only leave display separators', async () => {
    const fallbackTokens = 'And I think a kind of cleareyed sober response where it is like hey.'
      .split(' ')
      .map((text, index) => ({
        id: `fallback-${index}`,
        cueId: 'fallback-cue',
        startMs: index * 200,
        endMs: (index + 1) * 200,
        text,
      }));
    const responses = [
      {
        units: [
          {
            startIndex: 0,
            endIndex: 13,
            translation: '我认为应该清醒回应，就像这样说嘿',
            sentenceEnd: true,
          },
        ],
      },
      {
        units: [
          {
            startIndex: 0,
            endIndex: 7,
            translation: '我认为应该保持清醒理智',
            sentenceEnd: false,
          },
          {
            startIndex: 8,
            endIndex: 13,
            translation: '回应就像是，接着说嘿',
            sentenceEnd: true,
          },
        ],
      },
      {
        units: [
          {
            startIndex: 0,
            endIndex: 7,
            translation: '我认为应该保持清醒理智',
            sentenceEnd: false,
          },
          {
            startIndex: 8,
            endIndex: 10,
            translation: '回应就像',
            sentenceEnd: false,
          },
          {
            startIndex: 11,
            endIndex: 13,
            translation: '这样来说，接着说嘿',
            sentenceEnd: true,
          },
        ],
      },
      {
        units: [
          { startIndex: 8, endIndex: 10, translation: '回应就像', sentenceEnd: false },
          { startIndex: 11, endIndex: 11, translation: '这', sentenceEnd: false },
          { startIndex: 12, endIndex: 13, translation: '这样来说，接着说嘿', sentenceEnd: true },
        ],
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(completion(responses[0]!))
      .mockResolvedValueOnce(completion(responses[1]!))
      .mockResolvedValueOnce(completion(responses[2]!))
      .mockResolvedValueOnce(completion(responses[3]!));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });
    const progress: string[] = [];

    const result = await translateTokenWindow(settings, fallbackTokens, (stage) => {
      progress.push(stage);
    });

    expect(result.map((cue) => cue.translation)).toEqual([
      '我认为应该保持清醒理智',
      '回应就像',
      '这',
      '这样来说接着说嘿',
    ]);
    expect(result.flatMap((cue) => cue.sourceTokenIds)).toEqual(
      fallbackTokens.map((token) => token.id),
    );
    expect(progress).toEqual([
      'translating',
      'repairing-boundaries',
      'repairing-boundaries',
      'repairing-boundaries',
    ]);
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

  it('aborts an in-flight model request when its playback session is cancelled', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });
    const controller = new AbortController();

    const request = translateTokenWindow(settings, tokens, undefined, controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort();

    await expect(request).rejects.toMatchObject({ code: 'cancelled' });
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
