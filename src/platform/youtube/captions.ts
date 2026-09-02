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

  return parseJson3Captions((await response.json()) as Json3CaptionPayload);
}
