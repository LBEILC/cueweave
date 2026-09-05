import { describe, expect, it } from 'vitest';
import type { TokenWindow } from '@cueweave/core/subtitle';
import {
  bufferPresentation,
  failedBufferWindow,
  PLAYBACK_BUFFER_POLICY,
  selectBufferWork,
  type BufferWindowState,
  type PlaybackPosition,
} from './playbackBuffer';

const windows: TokenWindow[] = Array.from({ length: 30 }, (_, i) => ({
  id: `playback:${i}`,
  startMs: i * 30_000,
  endMs: (i + 1) * 30_000,
  tokens: [],
}));
const position: PlaybackPosition = {
  timeMs: 0,
  paused: false,
  playbackRate: 1,
  enabled: true,
  seeking: false,
};
const ready: BufferWindowState = { status: 'ready', priority: 'prefetch' };
const states = (...indices: number[]) => new Map(indices.map((i) => [windows[i]!.id, ready]));
const select = (s = states(), p = position, now = 0) => selectBufferWork(windows, s, p, now);

describe('continuous subtitle buffer', () => {
  it('counts only the contiguous ready prefix, not a later isolated success', () => {
    const result = select(states(0, 2, 3));
    expect(result.buffer.availableSeconds).toBe(30);
    expect(result.buffer.contiguousUntilMs).toBe(30_000);
    expect(result.work.map((w) => w.window.id)).toEqual(['playback:1']);
    expect(result.work[0]!.priority).toBe('current');
  });
  it('measures from the playhead even when the current window is almost over', () => {
    expect(select(states(0), { ...position, timeMs: 29_000 }).buffer.availableSeconds).toBe(1);
    expect(select(states(0), { ...position, timeMs: 30_000 }).buffer.availableSeconds).toBe(0);
  });
  it('extends the paused target without translating the whole video', () => {
    expect(select(states(0, 1, 2)).work).toEqual([]);
    const paused = select(states(0, 1, 2), { ...position, paused: true });
    expect(paused.buffer.targetSeconds).toBe(120);
    expect(paused.work.map((w) => w.window.id)).toEqual(['playback:3']);
    expect(select(states(0, 1, 2, 3), { ...position, paused: true }).work).toEqual([]);
  });
  it('adjusts to playback speed and caps speculative video time', () => {
    expect(select(states(0, 1, 2), { ...position, playbackRate: 2 }).buffer.availableSeconds).toBe(
      45,
    );
    expect(select(states(0, 1, 2), { ...position, playbackRate: 2 }).buffer.targetSeconds).toBe(90);
    expect(select(states(), { ...position, playbackRate: 8 }).buffer.targetSeconds).toBe(300 / 8);
    expect(select(states(), { ...position, playbackRate: NaN }).buffer.targetSeconds).toBe(90);
  });
  it('treats true source silence as available but not an unfinished source window', () => {
    const gap = [
      { ...windows[0]!, endMs: 10_000 },
      { ...windows[1]!, startMs: 40_000 },
    ];
    const result = selectBufferWork(gap, states(0), { ...position, timeMs: 12_000 }, 0);
    expect(result.buffer.availableSeconds).toBe(28);
    expect(result.buffer.firstMissingIndex).toBe(1);
  });
  it('caps the advertised target together with the window-count limit', () => {
    const tiny = windows.map((w, i) => ({ ...w, startMs: i * 1000, endMs: (i + 1) * 1000 }));
    const readyStates = states(
      ...Array.from({ length: PLAYBACK_BUFFER_POLICY.maxWindows }, (_, i) => i),
    );
    const result = selectBufferWork(tiny, readyStates, position, 0);
    expect(result.buffer.targetSeconds).toBe(20);
    expect(result.buffer.availableSeconds).toBe(20);
    expect(result.work).toEqual([]);
    expect(bufferPresentation(result.buffer).status).toBe('ready');
  });
  it('handles the end, short videos and empty tracks honestly', () => {
    expect(select(states(), { ...position, timeMs: 999999 }).buffer.complete).toBe(true);
    const short = selectBufferWork(windows.slice(0, 1), states(0), position, 0);
    expect(short.buffer.availableSeconds).toBe(30);
    expect(bufferPresentation(short.buffer).message).toBe('剩余字幕已全部准备好。');
    expect(selectBufferWork([], states(), position, 0).buffer.complete).toBe(false);
  });
  it('pauses dispatch during seeking, disabled captions or source-only mode', () => {
    for (const p of [
      { ...position, enabled: false },
      { ...position, seeking: true },
    ])
      expect(select(states(), p).work).toEqual([]);
  });
  it('seeks into the neighborhood without dispatching earlier windows', () => {
    expect(select(states(), { ...position, timeMs: 601000 }).work.map((w) => w.window.id)).toEqual([
      'playback:20',
      'playback:21',
    ]);
  });
});

describe('hole-first scheduling and bounded retries', () => {
  it('starts two bounded jobs and promotes the nearest existing job without restarting it', () => {
    const s = states();
    expect(select(s).work.map((w) => w.priority)).toEqual(['current', 'prefetch']);
    s.set('playback:0', { status: 'working', priority: 'prefetch' });
    s.set('playback:1', { status: 'working', priority: 'prefetch' });
    const result = select(s);
    expect(result.work).toEqual([]);
    expect(result.promotions.map((w) => w.id)).toEqual(['playback:0']);
  });
  it('reserves a slot for a retry while letting later windows proceed', () => {
    const failure = failedBufferWindow(undefined, 'network', 'offline', 'current', 0);
    const s = states();
    s.set('playback:0', failure);
    expect(select(s, position, 500).work.map((w) => w.window.id)).toEqual(['playback:1']);
    s.set('playback:1', { status: 'working', priority: 'prefetch' });
    expect(select(s, position, 1000).work).toEqual([]);
    const retry = select(s, position, failure.retryAt!);
    expect(retry.work.map((w) => w.window.id)).toEqual(['playback:0']);
    expect(retry.work[0]!.priority).toBe('current');
  });
  it('does not let a failed first window terminate preparation of later windows', () => {
    const s = states(1);
    s.set('playback:0', failedBufferWindow(undefined, 'invalid-response', 'invalid', 'current', 0));
    const result = select(s, position, 0);
    expect(result.work.map((w) => w.window.id)).toEqual(['playback:2']);
    expect(result.buffer.availableSeconds).toBe(0);
  });
  it('stops automatically retrying after the bounded budget is exhausted', () => {
    let state: BufferWindowState | undefined;
    for (let i = 0; i <= PLAYBACK_BUFFER_POLICY.retryDelaysMs.length; i++)
      state = failedBufferWindow(state, 'network', 'offline', 'current', i * 30000);
    expect(state!.retryAt).toBeUndefined();
    const s = states(1, 2);
    s.set('playback:0', state!);
    expect(select(s, position, 999999).work).toEqual([]);
    expect(bufferPresentation(select(s).buffer, state).message).toContain('自动重试未完成');
  });
  it('does not repeatedly hit a service with missing permissions or an invalid key', () => {
    for (const code of [
      'not-configured',
      'permission-missing',
      'authentication',
      'model-not-found',
    ]) {
      const failure = failedBufferWindow(undefined, code, '需要配置', 'prefetch', 0);
      const s = states();
      s.set('playback:3', failure);
      expect(failure.retryAt).toBeUndefined();
      expect(select(s, position, 99999).work).toEqual([]);
    }
  });
  it('never labels a buffer with a hole as ready or uses the farthest success timestamp', () => {
    const s = states(0, 2, 3);
    const failure = failedBufferWindow(undefined, 'network', 'offline', 'current', 0);
    s.set('playback:1', failure);
    const presentation = bufferPresentation(select(s).buffer, failure);
    expect(presentation.status).toBe('error');
    expect(presentation.message).toContain('连续准备 30 秒');
    expect(presentation.message).toContain('自动重试');
    expect(presentation.message).not.toContain('120');
  });
  it('does not report a failure beyond the target as an immediate buffer shortage', () => {
    const s = states(0, 1, 2);
    const failure = failedBufferWindow(undefined, 'network', 'offline', 'prefetch', 0);
    s.set('playback:3', failure);
    expect(bufferPresentation(select(s).buffer, failure).status).toBe('ready');
  });
});
