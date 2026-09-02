import type { RawCue } from '../../domain/subtitle';
import type { CaptionTrack } from './types';

interface Json3Segment {
  utf8?: string;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Segment[];
}

interface Json3CaptionPayload {
  events?: Json3Event[];
}

interface ParsedCaptionEvent {
  startMs: number;
  durationMs: number;
  text: string;
}

const PLAYBACK_CONTEXT_PARAMS = [
  'pot',
  'potc',
  'c',
  'cver',
  'cplayer',
  'cbr',
  'cbrver',
  'cos',
  'cosver',
  'cplatform',
  'xorb',
  'xobt',
  'xovt',
] as const;

function parseCaptionEvents(payload: Json3CaptionPayload): ParsedCaptionEvent[] {
  return (payload.events ?? [])
    .map((event) => ({
      startMs: event.tStartMs ?? 0,
      durationMs: event.dDurationMs ?? 0,
      text: (event.segs ?? []).map((segment) => segment.utf8 ?? '').join(''),
    }))
    .filter((event) => event.text.trim().length > 0);
}

export function parseJson3Captions(payload: Json3CaptionPayload): RawCue[] {
  const events = parseCaptionEvents(payload);

  return events.map((event, index) => {
    const next = events[index + 1];
    const fallbackEndMs = next?.startMs ?? event.startMs + 2_000;
    const endMs = event.durationMs > 0 ? event.startMs + event.durationMs : fallbackEndMs;

    return {
      id: `yt:${index}:${event.startMs}`,
      startMs: event.startMs,
      endMs: Math.max(event.startMs + 1, endMs),
      text: event.text,
    };
  });
}

export function addPlaybackContext(track: CaptionTrack, observedCaptionUrl: string): CaptionTrack {
  const target = new URL(track.baseUrl);
  const observed = new URL(observedCaptionUrl);

  for (const key of PLAYBACK_CONTEXT_PARAMS) {
    const value = observed.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }

  return { ...track, baseUrl: target.toString() };
}

export async function fetchCaptionTrack(
  track: CaptionTrack,
  signal?: AbortSignal,
): Promise<RawCue[]> {
  const url = new URL(track.baseUrl);
  url.searchParams.set('fmt', 'json3');

  const response = await fetch(url, {
    credentials: 'include',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(
      `YouTube subtitle request failed with HTTP ${response.status}. Reload the video and try again.`,
    );
  }

  const body = await response.text();
  if (!body.trim()) {
    throw new Error('YouTube 返回了空字幕数据，请刷新视频页面后重试。');
  }

  let payload: Json3CaptionPayload;
  try {
    payload = JSON.parse(body) as Json3CaptionPayload;
  } catch {
    throw new Error('YouTube 返回了无法识别的字幕格式，请刷新视频页面后重试。');
  }

  const cues = parseJson3Captions(payload);
  if (cues.length === 0) {
    throw new Error('YouTube 字幕轨中没有可显示的文本。');
  }

  return cues;
}
