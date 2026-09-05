import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OPEN_PLAYBACK_PLAN_MESSAGE,
  PREPARE_PLAYBACK_WINDOW_MESSAGE,
  TRANSLATE_WINDOW_MESSAGE,
  GET_TRANSLATION_CACHE_STATS_MESSAGE,
  type PlaybackPlanResult,
  type TranslateWindowResult,
} from './messages';
import { PlaybackPlan } from '@cueweave/core/provider/playbackPlan';

const tokens = [{ id: 'hello', cueId: 'greeting', startMs: 0, endMs: 2000, text: 'Hello.' }];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function background() {
  let receive!: (message: unknown, sender: object) => unknown;
  const stored: Record<string, unknown> = {
    'cueweave.provider': {
      baseUrl: 'https://relay.test/v1',
      model: 'model',
      apiKey: 'test',
      protocol: 'chat-completions',
    },
  };
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                units: [{ startIndex: 0, endIndex: 0, translation: '你好', sentenceEnd: true }],
                corrections: [],
                terminology: [],
              }),
            },
          },
        ],
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('defineBackground', (fn: () => void) => fn());
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: async (keys: string[] | null) =>
          Object.fromEntries(Object.entries(stored).filter(([k]) => !keys || keys.includes(k))),
        set: async (values: object) => {
          Object.assign(stored, values);
        },
        remove: async (keys: string[]) => {
          for (const k of keys) delete stored[k];
        },
        setAccessLevel: async () => {},
      },
    },
    permissions: { contains: async () => true },
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: {
        addListener: (fn: typeof receive) => {
          receive = fn;
        },
      },
    },
    tabs: { sendMessage: async () => {}, query: async () => [] },
  });
  await import('../../entrypoints/background');
  return {
    fetchMock,
    stored,
    send: async (message: object) => receive(message, { tab: { id: 1 } }),
  };
}
const translationMessage = {
  type: TRANSLATE_WINDOW_MESSAGE,
  tokens,
  priority: 'current',
  neighbors: { before: '', after: '' },
  context: {
    videoId: 'video',
    languageCode: 'en',
    windowId: 'playback:0',
    sessionId: 'session',
    correctionEnabled: true,
  },
};

describe('extension background playback wiring', () => {
  it('delivers valid partial cues without caching the incomplete window', async () => {
    const app = await background();
    app.fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    units: [
                      { startIndex: 0, endIndex: 0, translation: '你好', sentenceEnd: true },
                      { startIndex: 1, endIndex: 1, translation: 'GPT-4o', sentenceEnd: true },
                    ],
                    corrections: [],
                    terminology: [],
                  }),
                },
              },
            ],
          }),
        ),
    );
    const result = await app.send({
      ...translationMessage,
      tokens: [...tokens, { ...tokens[0], id: 'model', text: 'Astra', startMs: 2000, endMs: 4000 }],
    });
    expect(result).toMatchObject({
      ok: false,
      cues: [expect.objectContaining({ translation: '你好' })],
      missingTokenIds: ['model'],
    });
    expect(
      await app.send({ type: GET_TRANSLATION_CACHE_STATS_MESSAGE, videoId: 'video' }),
    ).toMatchObject({ ok: true, stats: { entryCount: 0 } });
  });
  it('opens and restores the planning protocol, translates with first-pass, then reuses cache', async () => {
    const app = await background();
    const opened = (await app.send({
      type: OPEN_PLAYBACK_PLAN_MESSAGE,
      videoId: 'video',
      languageCode: 'en',
      tokens,
    })) as PlaybackPlanResult;
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('open failed');
    const prepared = (await app.send({
      type: PREPARE_PLAYBACK_WINDOW_MESSAGE,
      key: opened.key,
      index: 0,
      sessionId: 'session',
      priority: 'current',
    })) as PlaybackPlanResult;
    expect(prepared).toEqual({
      ok: true,
      key: opened.key,
      snapshot: new PlaybackPlan(tokens).snapshot(),
    });
    const first = (await app.send(translationMessage)) as TranslateWindowResult;
    expect(first.ok && first.cues[0]!.translation).toBe('你好');
    const cached = (await app.send(translationMessage)) as TranslateWindowResult;
    expect(cached.ok && cached.cacheHit).toBe(true);
    expect(app.fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(app.fetchMock.mock.calls[0]![1].body).max_completion_tokens).toBe(8192);
  });
  it('does not publish or cache a window whose recovery still misses content', async () => {
    const app = await background();
    app.fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: '{"units":[]}' } }],
          }),
        ),
    );
    const result = (await app.send(translationMessage)) as TranslateWindowResult;
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
    expect(app.fetchMock).toHaveBeenCalledTimes(2);
    expect(
      await app.send({ type: GET_TRANSLATION_CACHE_STATS_MESSAGE, videoId: 'video' }),
    ).toMatchObject({ ok: true, stats: { entryCount: 0 } });
  });
  it('returns an explicit reopen signal when the background no longer has the plan in memory', async () => {
    const app = await background();
    expect(
      await app.send({
        type: PREPARE_PLAYBACK_WINDOW_MESSAGE,
        key: `cueweave.playback-plan.${'a'.repeat(64)}`,
        index: 0,
        sessionId: 'session',
        priority: 'current',
      }),
    ).toMatchObject({ ok: false, expired: true });
    expect(app.fetchMock).not.toHaveBeenCalled();
  });
});
