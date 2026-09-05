import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackPlan } from '@cueweave/core/provider/playbackPlan';
import { parseJson3Captions } from '../platform/youtube/captions';
import type { RawCue } from '@cueweave/core/subtitle';
import pauseFixture from '../../../../test/fixtures/youtube/87DyyMV0kCY.en.395000-433000.json';
import { DEFAULT_SUBTITLE_PREFERENCES } from '../settings/subtitle';
import {
  OPEN_PLAYBACK_PLAN_MESSAGE,
  PREPARE_PLAYBACK_WINDOW_MESSAGE,
  TRANSLATE_WINDOW_MESSAGE,
  type TranslateWindowMessage,
  type TranslateWindowResult,
} from './messages';
import {
  CAPTION_TRACK_REQUEST_EVENT,
  CAPTION_TRACK_RESPONSE_EVENT,
  CAPTION_TRACKS_EVENT,
  GET_CONTENT_SETTINGS_MESSAGE,
  GET_CONTENT_STATE_MESSAGE,
  GET_TRANSCRIPT_REPORT_MESSAGE,
  SET_CONTENT_ENABLED_MESSAGE,
  SET_SUBTITLE_PREFERENCES_MESSAGE,
  type ContentState,
  type TranscriptReport,
} from '../platform/youtube/types';

let invalidate: (() => void) | undefined;
afterEach(() => {
  invalidate?.();
  invalidate = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock('../ui/player-overlay');
  vi.resetModules();
});

async function player(
  paused: boolean,
  respond: (m: TranslateWindowMessage, count: number) => TranslateWindowResult = success,
  rawCues?: RawCue[],
) {
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let receive!: (message: object) => unknown;
  let plan: PlaybackPlan;
  const calls: TranslateWindowMessage[] = [];
  const element = () =>
    Object.assign(new EventTarget(), {
      dataset: {} as Record<string, string>,
      textContent: '',
      isConnected: true,
      setAttribute: vi.fn(),
      remove: vi.fn(),
    });
  const overlay = {
    host: element(),
    caption: element(),
    translation: element(),
    source: element(),
    action: element(),
    fit: vi.fn(),
    dispose: vi.fn(),
  };
  vi.doMock('../ui/player-overlay', () => ({
    createSubtitleOverlay: () => overlay,
    applyOverlayPreferences: vi.fn(),
  }));
  const video = Object.assign(new EventTarget(), {
    currentTime: 0,
    paused,
    playbackRate: 1,
    seeking: false,
    play: vi.fn(),
    pause: vi.fn(),
  });
  const win = Object.assign(new EventTarget(), {
    location: { href: 'https://www.youtube.com/watch?v=video' },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: vi.fn<(callback: FrameRequestCallback) => number>().mockReturnValue(0),
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    title: 'Test - YouTube',
    getElementById: () => null,
    querySelector: (selector: string) =>
      selector === 'video.html5-main-video'
        ? video
        : selector === '.html5-video-player'
          ? { append: vi.fn() }
          : null,
  });
  vi.stubGlobal('defineContentScript', (definition: unknown) => definition);
  vi.stubGlobal('browser', {
    runtime: {
      getURL: (path: string) => path,
      onMessage: {
        addListener: (listener: typeof receive) => {
          receive = listener;
        },
      },
      sendMessage: async (m: Record<string, unknown>) => {
        if (m.type === GET_CONTENT_SETTINGS_MESSAGE)
          return { enabled: true, subtitlePreferences: DEFAULT_SUBTITLE_PREFERENCES };
        if (m.type === OPEN_PLAYBACK_PLAN_MESSAGE) {
          plan = new PlaybackPlan(m.tokens as TranslateWindowMessage['tokens']);
          return { ok: true, key: 'plan', snapshot: plan.snapshot() };
        }
        if (m.type === PREPARE_PLAYBACK_WINDOW_MESSAGE)
          return { ok: true, key: 'plan', snapshot: plan.snapshot() };
        if (m.type === TRANSLATE_WINDOW_MESSAGE) {
          const message = m as unknown as TranslateWindowMessage;
          calls.push(message);
          await new Promise((resolve) => setTimeout(resolve, 100));
          return respond(
            message,
            calls.filter((c) => c.context.windowId === message.context.windowId).length,
          );
        }
        return { ok: true };
      },
    },
  });
  const script = await import('../../entrypoints/youtube.content/index');
  const main = script.default.main!;
  await main({
    onInvalidated: (callback: () => void) => {
      invalidate = callback;
    },
  } as NonNullable<Parameters<typeof main>[0]>);
  win.addEventListener(CAPTION_TRACK_REQUEST_EVENT, (event) => {
    const detail = JSON.parse((event as CustomEvent<string>).detail);
    const cues = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      startMs: i * 30000,
      endMs: (i + 1) * 30000,
      text: Array.from({ length: 50 }, (_, j) => `word${i}part${j}`).join(' ') + '.',
    }));
    win.dispatchEvent(
      new CustomEvent(CAPTION_TRACK_RESPONSE_EVENT, {
        detail: JSON.stringify({ requestId: detail.requestId, ok: true, cues: rawCues ?? cues }),
      }),
    );
  });
  win.dispatchEvent(
    new CustomEvent(CAPTION_TRACKS_EVENT, {
      detail: {
        videoId: 'video',
        tracks: [
          {
            baseUrl: 'https://www.youtube.com/timedtext',
            languageCode: 'en',
            name: 'English',
            isAutoGenerated: true,
          },
        ],
      },
    }),
  );
  return {
    video,
    win,
    calls,
    overlay,
    render: () => win.requestAnimationFrame.mock.calls.at(-1)![0](0),
    send: async (message: object) => receive(message),
    state: async () => receive({ type: GET_CONTENT_STATE_MESSAGE }) as Promise<ContentState>,
  };
}
function success(message: TranslateWindowMessage): TranslateWindowResult {
  return {
    ok: true,
    cacheHit: false,
    cues: [
      {
        id: message.context.windowId,
        sourceTokenIds: message.tokens.map((t) => t.id),
        startMs: message.tokens[0]!.startMs,
        endMs: message.tokens.at(-1)!.endMs,
        sourceText: 'source',
        originalText: 'source',
        corrections: [],
        translation: '译文',
        sentenceEnd: true,
        status: 'translated',
      },
    ],
  };
}

describe('content-script buffer scheduling', () => {
  it('retries disjoint missing ranges without resending already accepted tokens', async () => {
    let acceptedIds: string[] = [];
    const app = await player(true, (message, count) => {
      if (count > 1 || message.context.windowId !== 'playback:0') return success(message);
      const middle = message.tokens.slice(2, 4);
      const accepted = success({ ...message, tokens: middle });
      if (!accepted.ok) throw new Error('fixture');
      accepted.cues[0]!.id = 'partial-middle';
      acceptedIds = middle.map((t) => t.id);
      return {
        ok: false,
        error: { code: 'invalid-response', message: 'Partial' },
        cues: accepted.cues,
      };
    });
    await vi.advanceTimersByTimeAsync(1000);
    app.render();
    app.overlay.action.dispatchEvent(new Event('click'));
    await vi.advanceTimersByTimeAsync(1000);
    const requests = app.calls.filter((c) => c.context.windowId === 'playback:0');
    expect(requests).toHaveLength(3);
    expect(requests[1]!.tokens.map((t) => t.id)).toEqual(
      requests[0]!.tokens.slice(0, 2).map((t) => t.id),
    );
    expect(requests[2]!.tokens.map((t) => t.id)).toEqual(
      requests[0]!.tokens.slice(4).map((t) => t.id),
    );
    expect(
      requests
        .slice(1)
        .flatMap((r) => r.tokens)
        .some((t) => acceptedIds.includes(t.id)),
    ).toBe(false);
  });
  it('shows accepted partial subtitles while leaving the window incomplete', async () => {
    const app = await player(true, (message) => {
      const accepted = success({ ...message, tokens: message.tokens.slice(0, 2) });
      if (!accepted.ok) throw new Error('fixture');
      return {
        ok: false,
        error: { code: 'invalid-response', message: 'Partial translation' },
        cues: accepted.cues,
        missingTokenIds: message.tokens.slice(2).map((t) => t.id),
      };
    });
    await vi.advanceTimersByTimeAsync(1000);
    app.render();
    expect(app.overlay.translation.textContent).toBe('译文');
    expect((await app.state()).bufferedSeconds).toBe(0);
  });
  it('keeps a translated pause empty instead of showing an early source-only fallback at 6:59', async () => {
    const app = await player(
      true,
      (message) => {
        const split = message.tokens.findIndex((token) => token.startMs >= 421_199);
        const groups =
          split > 0
            ? [message.tokens.slice(0, split), message.tokens.slice(split)]
            : [message.tokens];
        return {
          ok: true,
          cacheHit: true,
          cues: groups.map((tokens, index) => ({
            id: `${message.context.windowId}:${index}`,
            sourceTokenIds: tokens.map((token) => token.id),
            startMs: tokens[0]!.startMs,
            endMs: tokens.at(-1)!.endMs,
            sourceText: tokens.map((token) => token.text).join(' '),
            translation: '然后执行一系列终端命令或工具调用来完成工作',
            sentenceEnd: true,
            status: 'translated',
          })),
        };
      },
      parseJson3Captions(pauseFixture),
    );
    app.video.currentTime = 419;
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await app.state()).translatedWindowCount).toBeGreaterThan(0);
    app.render();
    expect(app.overlay.caption.dataset.visible).toBe('false');
    expect(app.overlay.source.textContent).toBe('');
    expect(app.overlay.translation.textContent).toBe('');

    app.video.currentTime = 422;
    app.render();
    expect(app.overlay.caption.dataset.visible).toBe('true');
    expect(app.overlay.source.textContent).toContain('then take a series of terminal commands');
    expect(app.overlay.translation.textContent).toContain('然后执行一系列终端命令');
  });

  it('still shows source text and retry action when translation really failed', async () => {
    const app = await player(true, () => ({
      ok: false,
      error: { code: 'network', message: 'Temporary failure' },
    }));
    await vi.advanceTimersByTimeAsync(1_000);
    app.render();
    expect(app.overlay.caption.dataset.visible).toBe('true');
    expect(app.overlay.source.textContent).toContain('word0part0');
    expect(app.overlay.action.textContent).toBe('重试翻译此处');
  });

  it('fills the paused horizon, stops there, and never controls video playback', async () => {
    const app = await player(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect((await app.state()).bufferedSeconds).toBe(120);
    expect(app.calls.map((c) => c.context.windowId)).toEqual([
      'playback:0',
      'playback:1',
      'playback:2',
      'playback:3',
    ]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(app.calls).toHaveLength(4);
    expect(app.video.play).not.toHaveBeenCalled();
    expect(app.video.pause).not.toHaveBeenCalled();
  });
  it('expands the target on pause and replenishes it as the playhead advances', async () => {
    const app = await player(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect((await app.state()).bufferedSeconds).toBe(90);
    app.video.paused = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect((await app.state()).bufferedSeconds).toBe(120);
    app.video.paused = false;
    app.video.currentTime = 65;
    await vi.advanceTimersByTimeAsync(2000);
    expect((await app.state()).bufferedSeconds).toBeGreaterThanOrEqual(90);
    expect(app.calls.filter((c) => c.context.windowId === 'playback:0')).toHaveLength(1);
  });
  it('fills a temporary hole automatically while later success never claims contiguous readiness', async () => {
    const app = await player(false, (m, count) =>
      m.context.windowId === 'playback:0' && count === 1
        ? { ok: false, error: { code: 'network', message: 'Temporary failure' } }
        : success(m),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect((await app.state()).bufferedSeconds).toBe(0);
    expect((await app.state()).aiStatus).toBe('error');
    expect(app.calls.some((c) => c.context.windowId === 'playback:2')).toBe(true);
    await vi.advanceTimersByTimeAsync(2500);
    expect((await app.state()).bufferedSeconds).toBe(90);
    expect(app.calls.filter((c) => c.context.windowId === 'playback:0')).toHaveLength(2);
    expect(app.calls.at(-1)!.priority).toBe('current');
  });
  it('bounds repeated failures and keeps an exhausted hole visible', async () => {
    const app = await player(false, (m) =>
      m.context.windowId === 'playback:0'
        ? { ok: false, error: { code: 'invalid-response', message: 'Invalid output' } }
        : success(m),
    );
    await vi.advanceTimersByTimeAsync(60000);
    expect(app.calls.filter((c) => c.context.windowId === 'playback:0')).toHaveLength(4);
    expect((await app.state()).bufferedSeconds).toBe(0);
    expect((await app.state()).aiMessage).toContain('自动重试未完成');
  });
  it('does not publish a late old-video response or dispatch when disabled or source-only', async () => {
    const app = await player(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(app.calls).toHaveLength(2);
    app.win.dispatchEvent(new Event('yt-navigate-start'));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await app.state()).translatedWindowCount).toBe(0);
    const report = (await app.send({ type: GET_TRANSCRIPT_REPORT_MESSAGE })) as TranscriptReport;
    expect(report.translatedCues).toEqual([]);
    await app.send({ type: SET_CONTENT_ENABLED_MESSAGE, enabled: false });
    await app.send({
      type: SET_SUBTITLE_PREFERENCES_MESSAGE,
      preferences: { ...DEFAULT_SUBTITLE_PREFERENCES, displayMode: 'source' },
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(app.calls).toHaveLength(2);
  });
  it('stops in-flight publication when disabled and resumes after re-enabling', async () => {
    const app = await player(false);
    await vi.advanceTimersByTimeAsync(50);
    await app.send({ type: SET_CONTENT_ENABLED_MESSAGE, enabled: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(app.calls).toHaveLength(2);
    expect((await app.state()).translatedWindowCount).toBe(0);
    await app.send({ type: SET_CONTENT_ENABLED_MESSAGE, enabled: true });
    await vi.advanceTimersByTimeAsync(3000);
    expect((await app.state()).bufferedSeconds).toBe(90);
  });
  it('does not prefetch in source-only mode and resumes at the current position', async () => {
    const app = await player(false);
    await vi.advanceTimersByTimeAsync(3000);
    await app.send({
      type: SET_SUBTITLE_PREFERENCES_MESSAGE,
      preferences: { ...DEFAULT_SUBTITLE_PREFERENCES, displayMode: 'source' },
    });
    app.video.currentTime = 120;
    await vi.advanceTimersByTimeAsync(5000);
    expect(app.calls).toHaveLength(3);
    expect((await app.state()).bufferedSeconds).toBeUndefined();
    await app.send({
      type: SET_SUBTITLE_PREFERENCES_MESSAGE,
      preferences: DEFAULT_SUBTITLE_PREFERENCES,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(app.calls.slice(3).map((c) => c.context.windowId)).toEqual([
      'playback:4',
      'playback:5',
      'playback:6',
    ]);
    expect((await app.state()).bufferedSeconds).toBe(90);
  });
  it('cleans up timers and ignores pending results after the content script is invalidated', async () => {
    const app = await player(true);
    await vi.advanceTimersByTimeAsync(50);
    invalidate!();
    invalidate = undefined;
    await vi.advanceTimersByTimeAsync(5000);
    expect(app.calls).toHaveLength(2);
    expect((await app.state()).translatedWindowCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
