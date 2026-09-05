import type { TokenWindow } from '@cueweave/core/subtitle';
import { DEBUG_POLICY, type DebugRecord, type DebugSnapshot } from './types';

export function debugContextRange(timeMs: number | null, windows: readonly TokenWindow[]) {
  if (timeMs === null) return { windows: [], range: null };
  let nearest = 0;
  let distance = Infinity;
  windows.forEach((window, index) => {
    const d = Math.max(window.startMs - timeMs, timeMs - window.endMs, 0);
    if (d < distance) {
      nearest = index;
      distance = d;
    }
  });
  const selected = windows.slice(Math.max(0, nearest - 1), nearest + 2);
  return {
    windows: selected,
    range: {
      startMs: Math.min(Math.max(0, timeMs - 30_000), selected[0]?.startMs ?? timeMs),
      endMs: Math.max(timeMs + 30_000, selected.at(-1)?.endMs ?? timeMs),
    },
  };
}

export function selectDebugRecords(
  records: readonly DebugRecord[],
  videoId: string,
  tabId: number,
  snapshot: DebugSnapshot | null,
  capturedAt: number,
): DebugRecord[] {
  return records.filter((record) => {
    if (
      record.scope.videoId !== videoId ||
      (record.scope.tabId !== undefined && record.scope.tabId !== tabId)
    )
      return false;
    if (record.time > capturedAt) return false;
    const recent = record.time >= capturedAt - DEBUG_POLICY.recentEventMs;
    const range = snapshot?.range;
    const overlaps =
      !!range &&
      typeof record.scope.startMs === 'number' &&
      typeof record.scope.endMs === 'number' &&
      record.scope.startMs <= range.endMs &&
      record.scope.endMs >= range.startMs;
    // Recent playback events explain seeks and buffering; request bodies stay scoped to the scene.
    return range
      ? overlaps ||
          (recent && record.kind === 'player-event') ||
          (record.scope.sessionId === snapshot.sessionId && record.scope.operation === 'entities')
      : recent;
  });
}

export function debugFilename(videoId: string, timeMs: number | null, capturedAt: number): string {
  const safeVideo = videoId.replace(/[^a-z\d_-]/giu, '_').slice(0, 64);
  const position = timeMs === null ? 'time-unknown' : `${Math.floor(timeMs / 1_000)}s`;
  return `cueweave-debug-${safeVideo}-${position}-${new Date(capturedAt).toISOString().replace(/[:.]/gu, '-')}.json`;
}
