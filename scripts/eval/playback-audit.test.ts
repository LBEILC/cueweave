import { describe, expect, it } from 'vitest';
import { auditPlaybackTiming, maximumRequestConcurrency } from './playback-audit';

describe('offline playback timing audit', () => {
  const first = { id: 'a', startMs: 400, endMs: 30400, readyAtMs: 9000, complete: true };
  it('starts only after the first complete window is ready', () => {
    expect(
      auditPlaybackTiming([
        first,
        { id: 'b', startMs: 30400, endMs: 60400, readyAtMs: 21000, complete: true },
      ]),
    ).toEqual({ startupMs: 9000, unavailable: [], late: [], minimumLeadMs: 18000 });
  });
  it('counts unavailable or partial windows separately instead of claiming continuous playback', () => {
    expect(
      auditPlaybackTiming([
        first,
        { id: 'b', startMs: 30400, endMs: 60400, readyAtMs: 21000, complete: false },
      ]).unavailable,
    ).toEqual(['b']);
    expect(auditPlaybackTiming([{ ...first, complete: false }]).startupMs).toBeNull();
  });
  it('reports late arrivals against uninterrupted playback deadlines', () => {
    expect(
      auditPlaybackTiming([
        first,
        { id: 'b', startMs: 30400, endMs: 60400, readyAtMs: 41000, complete: true },
      ]).late,
    ).toEqual([{ id: 'b', leadMs: -2000 }]);
  });
  it('does not count adjacent requests as concurrent', () => {
    expect(
      maximumRequestConcurrency([
        { startedAt: '2026-09-03T00:00:00Z', durationMs: 1000 },
        { startedAt: '2026-09-03T00:00:01Z', durationMs: 2000 },
      ]),
    ).toBe(1);
    expect(
      maximumRequestConcurrency([
        { startedAt: '2026-09-03T00:00:00Z', durationMs: 2000 },
        { startedAt: '2026-09-03T00:00:01Z', durationMs: 2000 },
      ]),
    ).toBe(2);
  });
});
