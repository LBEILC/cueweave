import { describe, expect, it } from 'vitest';
import { debugContextRange, selectDebugRecords } from './report';
import type { DebugRecord, DebugSnapshot } from './types';

describe('current scene selection', () => {
  it('keeps whole adjacent windows and handles gaps, end of video and missing time', () => {
    const windows = Array.from({ length: 5 }, (_, i) => ({
      id: `w${i}`,
      startMs: i * 45000,
      endMs: (i + 1) * 45000 - 1000,
      tokens: [],
    }));
    expect(debugContextRange(100000, windows).windows.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    expect(debugContextRange(44900, windows).windows.map((w) => w.id)).toEqual(['w0', 'w1', 'w2']);
    expect(debugContextRange(999999, windows).windows.map((w) => w.id)).toEqual(['w3', 'w4']);
    expect(debugContextRange(null, windows)).toEqual({ range: null, windows: [] });
    expect(debugContextRange(10000, []).range).toEqual({ startMs: 0, endMs: 40000 });
  });

  it('isolates video/tab and excludes unrelated request bodies while retaining recent seek events', () => {
    const now = 1_000_000;
    const base: DebugRecord = {
      id: 'a',
      time: now - 600_000,
      updatedAt: now - 600_000,
      scope: { videoId: 'video', tabId: 1, startMs: 60000, endMs: 90000 },
      kind: 'request',
      data: {},
    };
    const records = [
      base,
      { ...base, id: 'other-video', scope: { ...base.scope, videoId: 'other' } },
      { ...base, id: 'other-tab', scope: { ...base.scope, tabId: 2 } },
      {
        ...base,
        id: 'unrelated',
        time: now - 100,
        scope: { ...base.scope, startMs: 200000, endMs: 240000 },
      },
      {
        ...base,
        id: 'seek',
        time: now - 100,
        kind: 'player-event',
        scope: { videoId: 'video', tabId: 1 },
      },
      { ...base, id: 'future', time: now + 1 },
    ];
    const snapshot = { range: { startMs: 45000, endMs: 135000 }, sessionId: 's' } as DebugSnapshot;
    expect(selectDebugRecords(records, 'video', 1, snapshot, now).map((r) => r.id)).toEqual([
      'a',
      'seek',
    ]);
    expect(selectDebugRecords(records, 'video', 1, null, now).map((r) => r.id)).toEqual([
      'unrelated',
      'seek',
    ]);
  });
});
