import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportDebugReport } from './background';
import { DebugRecorder } from './recorder';
import type { DebugSnapshot } from './types';
import { DEFAULT_SUBTITLE_PREFERENCES } from '../settings/subtitle';

afterEach(() => vi.unstubAllGlobals());
const snapshot: DebugSnapshot = {
  capturedAt: Date.now(),
  videoId: 'video',
  sessionId: 'session',
  timeMs: 72500,
  contentBuild: 'older-content-build',
  videoTitle: 'Video',
  playback: null,
  state: {
    enabled: true,
    status: 'error',
    cueCount: 0,
    displayCueCount: 0,
    displayMode: 'bilingual',
    aiStatus: 'error',
  },
  preferences: { ...DEFAULT_SUBTITLE_PREFERENCES },
  track: null,
  range: { startMs: 40000, endMs: 120000 },
  windows: [],
  sourceTokens: [],
  rawCues: [],
  originalCues: [],
  translatedCues: [],
  display: {
    originalText: '',
    translationText: '',
    hidden: true,
    playerWidth: null,
    playerHeight: null,
    fullscreen: false,
  },
};

async function setup() {
  const values: Record<string, unknown> = {
    'cueweave.provider': {
      apiKey: 'sample-secret',
      baseUrl: 'https://example.com/v1?key=sample-url-secret',
      model: 'm',
      protocol: 'auto',
    },
  };
  const storage = {
    get: async () => structuredClone(values),
    set: async (next: object) => {
      Object.assign(values, structuredClone(next));
    },
  };
  const sendMessage = vi.fn(async () => structuredClone({ ...snapshot, capturedAt: Date.now() }));
  vi.stubGlobal('browser', {
    storage: { local: storage },
    tabs: {
      get: async () => ({ url: 'https://www.youtube.com/watch?v=video', title: 'Video' }),
      sendMessage,
    },
    runtime: { getManifest: () => ({ version: '1.0.0' }) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Export must not request a model');
    }),
  );
  const recorder = new DebugRecorder(storage);
  await recorder.setEnabled(true);
  return { recorder, sendMessage };
}

describe('diagnostic export', () => {
  it('exports the frozen time during a caption failure and identifies unavailable traces', async () => {
    const { recorder } = await setup();
    const capture = await recorder.capture({ videoId: 'other-video', tabId: 1 });
    await capture.record('player-event', { text: 'private unrelated video' });
    const result = await exportDebugReport(recorder, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = JSON.parse(result.json);
    expect(data.video.timeMs).toBe(72500);
    expect(data.video.url).toBe('https://www.youtube.com/watch?v=video');
    expect(data.snapshot.state.status).toBe('error');
    expect(data.build.content).toBe('older-content-build');
    expect(result.partial).toBe(true);
    expect(result.filename).toContain('-72s-');
    for (const secret of ['sample-secret', 'sample-url-secret', 'private unrelated video'])
      expect(result.json).not.toContain(secret);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('still exports available logs if the content script is missing, with unknown rather than zero time', async () => {
    const { recorder, sendMessage } = await setup();
    sendMessage.mockRejectedValue(new Error('No receiver'));
    const capture = await recorder.capture({ videoId: 'video', tabId: 1 });
    await capture.record('player-event', { event: 'failure' });
    const result = await exportDebugReport(recorder, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = JSON.parse(result.json);
    expect(data.video.timeMs).toBeNull();
    expect(data.snapshot).toBeNull();
    expect(data.records).toHaveLength(1);
    expect(result.filename).toContain('time-unknown');
  });

  it('does not export stale state from another video or an off/on recording generation', async () => {
    const { recorder, sendMessage } = await setup();
    sendMessage.mockResolvedValue({ ...snapshot, videoId: 'previous-video' });
    const result = await exportDebugReport(recorder, 1);
    expect(result.ok && JSON.parse(result.json).snapshot).toBeNull();
    sendMessage.mockImplementation(async () => {
      await recorder.setEnabled(false);
      await recorder.setEnabled(true);
      return snapshot;
    });
    expect(await exportDebugReport(recorder, 1)).toMatchObject({ ok: false });
  });
});
