import {
  addPlaybackContext,
  fetchCaptionTracksViaInnertube,
} from '../../src/platform/youtube/captions';
import { loadPageCaptionTrack, withCaptionTimeout } from '../../src/platform/youtube/track-loader';
import {
  mapCaptionTracks,
  type PlayerCaptionSelection,
  type YouTubeCaptionTrackList,
} from '../../src/platform/youtube/track-selection';
import {
  CAPTION_TRACK_REQUEST_EVENT,
  CAPTION_TRACK_RESPONSE_EVENT,
  CAPTION_TRACKS_EVENT,
  CAPTION_TRACKS_REQUEST_EVENT,
  type CaptionTrack,
  type CaptionTrackRequestDetail,
  type CaptionTrackResponseDetail,
  type CaptionTracksEventDetail,
} from '../../src/platform/youtube/types';

interface YouTubePlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: YouTubeCaptionTrackList;
  };
  videoDetails?: {
    videoId?: string;
  };
}

function readSelectedCaption(): PlayerCaptionSelection | undefined {
  const player = document.querySelector('.html5-video-player') as
    | (HTMLElement & { getOption?: (module: string, option: string) => PlayerCaptionSelection })
    | null;
  try {
    return player?.getOption?.('captions', 'track');
  } catch {
    return undefined;
  }
}

function readPlayerResponse(): YouTubePlayerResponse | undefined {
  const player = document.querySelector('.html5-video-player') as
    (HTMLElement & { getPlayerResponse?: () => YouTubePlayerResponse }) | null;
  try {
    const live = player?.getPlayerResponse?.();
    if (live?.videoDetails?.videoId === currentVideoId()) return live;
  } catch {
    // The player API is temporarily unavailable during navigation.
  }
  return (window as typeof window & { ytInitialPlayerResponse?: YouTubePlayerResponse })
    .ytInitialPlayerResponse;
}

function currentVideoId(): string {
  const url = new URL(window.location.href);
  return url.searchParams.get('v') ?? url.pathname.match(/^\/shorts\/([^/]+)/u)?.[1] ?? '';
}

function pageCaptionTracks(response: YouTubePlayerResponse | undefined): CaptionTrack[] {
  return mapCaptionTracks(
    response?.captions?.playerCaptionsTracklistRenderer,
    readSelectedCaption(),
  );
}

const trackRequests = new Map<string, Promise<CaptionTrack[]>>();

function discoverCaptionTracks(videoId: string, apiKey: string): Promise<CaptionTrack[]> {
  const existing = trackRequests.get(videoId);
  if (existing) return existing;

  const request = withCaptionTimeout((signal) =>
    fetchCaptionTracksViaInnertube({ videoId, apiKey, signal }),
  ).catch(() => {
    trackRequests.delete(videoId);
    return [];
  });
  trackRequests.set(videoId, request);
  if (trackRequests.size > 12) {
    const oldestVideoId = trackRequests.keys().next().value;
    if (oldestVideoId) trackRequests.delete(oldestVideoId);
  }
  return request;
}

async function publishCaptionTracks(): Promise<void> {
  const videoId = currentVideoId();
  if (!videoId) return;

  const response = readPlayerResponse();
  let tracks = response?.videoDetails?.videoId === videoId ? pageCaptionTracks(response) : [];
  if (tracks.length === 0) {
    const apiKey = readInnertubeApiKey();
    if (apiKey) tracks = await discoverCaptionTracks(videoId, apiKey);
  }
  if (currentVideoId() !== videoId) return;
  // A delayed discovery response must not clear tracks found while it was in flight.
  const current = readPlayerResponse();
  const currentTracks =
    current?.videoDetails?.videoId === videoId ? pageCaptionTracks(current) : [];
  if (currentTracks.length > 0) tracks = currentTracks;
  const detail: CaptionTracksEventDetail = {
    videoId,
    tracks: tracks.map((track) => {
      const observed = findObservedCaptionUrl(track);
      return observed ? addPlaybackContext(track, observed) : track;
    }),
  };

  window.dispatchEvent(new CustomEvent(CAPTION_TRACKS_EVENT, { detail }));
}

function parseCaptionTrackRequest(event: Event): CaptionTrackRequestDetail | undefined {
  const value = (event as CustomEvent<unknown>).detail;
  if (typeof value !== 'string') return undefined;

  try {
    const detail = JSON.parse(value) as CaptionTrackRequestDetail;
    const url = new URL(detail.track.baseUrl);
    const isYouTubeCaptionUrl =
      url.protocol === 'https:' &&
      (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) &&
      url.pathname === '/api/timedtext';

    return detail.requestId && detail.track.languageCode && isYouTubeCaptionUrl
      ? detail
      : undefined;
  } catch {
    return undefined;
  }
}

function publishCaptionTrackResponse(detail: CaptionTrackResponseDetail): void {
  window.dispatchEvent(
    new CustomEvent(CAPTION_TRACK_RESPONSE_EVENT, { detail: JSON.stringify(detail) }),
  );
}

// Resource timings can fill up before subtitles are enabled. Keep observing new entries.
const observedCaptionUrls = new Map<string, string>();

function captionContextKey(url: URL): string {
  return `${url.searchParams.get('v')}:${url.searchParams.get('lang')}:${url.searchParams.get('kind') ?? ''}`;
}

function rememberCaptionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !url.hostname.endsWith('.youtube.com') ||
      url.pathname !== '/api/timedtext' ||
      !url.searchParams.has('pot') ||
      url.searchParams.get('v') !== currentVideoId()
    )
      return false;
    const key = captionContextKey(url);
    const previous = observedCaptionUrls.get(key);
    observedCaptionUrls.set(key, value);
    if (observedCaptionUrls.size > 12) {
      observedCaptionUrls.delete(observedCaptionUrls.keys().next().value!);
    }
    return !previous || new URL(previous).searchParams.get('pot') !== url.searchParams.get('pot');
  } catch {
    return false;
  }
}

function findObservedCaptionUrl(track: CaptionTrack): string | undefined {
  const requested = new URL(track.baseUrl);
  const remembered = observedCaptionUrls.get(captionContextKey(requested));
  if (remembered) return remembered;
  const videoId = requested.searchParams.get('v');
  const entries = performance.getEntriesByType('resource').slice().reverse();

  for (const entry of entries) {
    try {
      const observed = new URL(entry.name);
      const isMatchingTrack =
        observed.hostname.endsWith('.youtube.com') &&
        observed.pathname === '/api/timedtext' &&
        observed.searchParams.get('v') === videoId &&
        observed.searchParams.get('lang') === track.languageCode &&
        observed.searchParams.get('kind') === requested.searchParams.get('kind') &&
        observed.searchParams.has('pot');
      if (isMatchingTrack) return observed.toString();
    } catch {
      // Ignore non-URL resource entries.
    }
  }

  return undefined;
}

function readInnertubeApiKey(): string | undefined {
  const configured = (
    window as typeof window & { ytcfg?: { get?: (key: string) => unknown } }
  ).ytcfg?.get?.('INNERTUBE_API_KEY');
  if (typeof configured === 'string' && configured.length > 0) return configured;

  for (const script of document.scripts) {
    const match = script.textContent?.match(/"INNERTUBE_API_KEY":"([A-Za-z0-9_-]+)"/u);
    if (match?.[1]) return match[1];
  }

  return undefined;
}

async function respondWithCaptionTrack(detail: CaptionTrackRequestDetail): Promise<void> {
  const apiKey = readInnertubeApiKey();
  try {
    const observedUrl = findObservedCaptionUrl(detail.track);
    const cues = await loadPageCaptionTrack({
      track: detail.track,
      ...(apiKey ? { apiKey } : {}),
      ...(observedUrl ? { observedTrack: addPlaybackContext(detail.track, observedUrl) } : {}),
    });
    publishCaptionTrackResponse({ requestId: detail.requestId, ok: true, cues });
  } catch (error) {
    publishCaptionTrackResponse({
      requestId: detail.requestId,
      ok: false,
      error: error instanceof Error ? error.message : '字幕轨读取失败，请刷新视频后重试。',
    });
  }
}

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const publishSoon = () => {
      window.setTimeout(() => void publishCaptionTracks(), 0);
      window.setTimeout(() => void publishCaptionTracks(), 600);
      window.setTimeout(() => void publishCaptionTracks(), 1_500);
    };

    window.addEventListener('yt-navigate-finish', publishSoon);
    window.addEventListener('yt-page-data-updated', publishSoon);
    window.addEventListener('popstate', publishSoon);
    window.addEventListener(CAPTION_TRACKS_REQUEST_EVENT, publishSoon);
    window.addEventListener(CAPTION_TRACK_REQUEST_EVENT, (event) => {
      const detail = parseCaptionTrackRequest(event);
      if (detail) void respondWithCaptionTrack(detail);
    });
    const observer = new PerformanceObserver((list) => {
      let changed = false;
      for (const entry of list.getEntries()) {
        if (rememberCaptionUrl(entry.name)) changed = true;
      }
      if (changed) void publishCaptionTracks();
    });
    observer.observe({ type: 'resource', buffered: true });
    // Caption selection changes do not reliably emit YouTube navigation events.
    let selectionKey = '';
    window.setInterval(() => {
      const selected = readSelectedCaption();
      const next = JSON.stringify([
        currentVideoId(),
        selected?.vss_id,
        selected?.languageCode,
        selected?.kind,
      ]);
      if (next === selectionKey) return;
      selectionKey = next;
      void publishCaptionTracks();
    }, 1_000);
    publishSoon();
  },
});
