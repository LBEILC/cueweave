import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPTION_TRACKS_EVENT, type CaptionTracksEventDetail } from './types';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function bridge() {
  vi.useFakeTimers();
  let selected = { languageCode: 'en', kind: 'asr', vss_id: 'a.en' };
  const win = Object.assign(new EventTarget(), {
    location: { href: 'https://www.youtube.com/watch?v=video' },
    setTimeout,
    setInterval,
  });
  const published: CaptionTracksEventDetail[] = [];
  win.addEventListener(CAPTION_TRACKS_EVENT, (event) => {
    published.push((event as CustomEvent<CaptionTracksEventDetail>).detail);
  });
  const player = {
    getOption: () => selected,
    getPlayerResponse: () => ({
      videoDetails: { videoId: 'video' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: ['ru', 'en'].map((languageCode) => ({
            baseUrl: `https://www.youtube.com/api/timedtext?v=video&lang=${languageCode}&kind=asr`,
            languageCode,
            kind: 'asr',
            vssId: `a.${languageCode}`,
          })),
          audioTracks: [{ defaultCaptionTrackIndex: 1 }],
        },
      },
    }),
  };
  let observe!: (list: { getEntries: () => { name: string }[] }) => void;
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      constructor(callback: typeof observe) {
        observe = callback;
      }
      observe = vi.fn();
    },
  );
  vi.stubGlobal('performance', { getEntriesByType: () => [] });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { querySelector: () => player, scripts: [] });
  vi.stubGlobal('defineContentScript', (definition: unknown) => definition);
  const script = await import('../../../entrypoints/youtube-bridge.content/index');
  const main = script.default.main!;
  main({} as NonNullable<Parameters<typeof main>[0]>);
  await vi.advanceTimersByTimeAsync(2_000);
  return {
    published,
    select: (languageCode: string) => {
      selected = { languageCode, kind: 'asr', vss_id: `a.${languageCode}` };
    },
    resource: (name: string) => observe({ getEntries: () => [{ name }] }),
  };
}

describe('caption bridge updates', () => {
  it('publishes native selection changes without navigation', async () => {
    const app = await bridge();
    expect(app.published.at(-1)?.tracks.find((track) => track.isSelected)?.languageCode).toBe('en');
    app.select('ru');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(app.published.at(-1)?.tracks.find((track) => track.isSelected)?.languageCode).toBe('ru');
  });

  it('recovers late player context even when the resource timing buffer has no entry', async () => {
    const app = await bridge();
    const before = app.published.length;
    const url = 'https://www.youtube.com/api/timedtext?v=video&lang=en&kind=asr&pot=proof&c=WEB';
    app.resource(url);
    expect(app.published).toHaveLength(before + 1);
    const tracks = app.published.at(-1)!.tracks;
    expect(tracks.find((track) => track.languageCode === 'en')?.baseUrl).toContain('pot=proof');
    expect(tracks.find((track) => track.languageCode === 'ru')?.baseUrl).not.toContain('pot=');
    app.resource(`${url}&fmt=json3`);
    expect(app.published).toHaveLength(before + 1);
    app.resource(url.replace('v=video', 'v=other'));
    expect(app.published).toHaveLength(before + 1);
  });
});
