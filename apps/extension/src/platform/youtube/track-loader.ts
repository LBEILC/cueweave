import type { RawCue } from '@cueweave/core/subtitle';
import { fetchCaptionTrack, fetchCaptionTrackViaInnertube } from './captions';
import type { CaptionTrack } from './types';

export const CAPTION_ATTEMPT_TIMEOUT_MS = 4_000;

/** Each attempt owns its timeout, including response-body reads. */
export async function withCaptionTimeout<T>(read: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error('YouTube 字幕请求超时，请刷新视频页面后重试。');
      reject(error);
      controller.abort(error);
    }, CAPTION_ATTEMPT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([read(controller.signal), timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

export async function loadPageCaptionTrack(options: {
  track: CaptionTrack;
  apiKey?: string;
  observedTrack?: CaptionTrack;
}): Promise<RawCue[]> {
  const { track, apiKey, observedTrack } = options;
  let webError: unknown;
  // Use the actual page track first; an unavailable fallback must not block it.
  try {
    return await withCaptionTimeout((signal) => fetchCaptionTrack(observedTrack ?? track, signal));
  } catch (error) {
    webError = error;
  }

  const videoId = new URL(track.baseUrl).searchParams.get('v');
  if (videoId && apiKey) {
    try {
      return await withCaptionTimeout((signal) =>
        fetchCaptionTrackViaInnertube({
          videoId,
          apiKey,
          preferredLanguageCode: track.languageCode,
          signal,
        }),
      );
    } catch {
      // The page-track failure is the actionable error for the current video.
    }
  }
  throw webError;
}
