import { describe, expect, it, vi } from 'vitest';
import { syncIndependentAudio } from './media-sync';

function media() {
  const video = {
    paused: false,
    ended: false,
    seeking: false,
    readyState: 4,
    currentTime: 5,
    playbackRate: 1.5,
    play: vi.fn(async () => {
      Object.assign(video, { paused: false });
    }),
    pause: vi.fn(() => {
      Object.assign(video, { paused: true });
    }),
  } as unknown as HTMLVideoElement;
  const audio = {
    paused: true,
    seeking: false,
    readyState: 1,
    currentTime: 0,
    playbackRate: 1,
    play: vi.fn(async () => {
      Object.assign(audio, { paused: false });
    }),
    pause: vi.fn(() => {
      Object.assign(audio, { paused: true });
    }),
  } as unknown as HTMLAudioElement;
  return { video, audio, state: { waiting: false } };
}
describe('independent audio loading and synchronization', () => {
  it('holds the video clock while audio buffers, then resumes the aligned pair', () => {
    const { video, audio, state } = media();
    for (let i = 0; i < 60; i++) syncIndependentAudio(video, audio, state);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.paused).toBe(true);
    expect(state.waiting).toBe(true);
    expect(audio.currentTime).toBe(0);
    expect(audio.play).not.toHaveBeenCalled();
    Object.assign(audio, { readyState: 4 });
    syncIndependentAudio(video, audio, state, true);
    expect(audio.currentTime).toBe(5);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(video.play).toHaveBeenCalledOnce();
    expect(state.waiting).toBe(false);
    expect(audio.playbackRate).toBe(1.5);
  });
  it('lets a pending audio seek finish at a fixed target before restarting', () => {
    const { video, audio, state } = media();
    Object.assign(audio, { readyState: 3, seeking: true });
    syncIndependentAudio(video, audio, state, true);
    expect(audio.currentTime).toBe(0);
    expect(video.paused).toBe(true);
    expect(state.waiting).toBe(true);
    Object.assign(audio, { seeking: false, currentTime: 5 });
    syncIndependentAudio(video, audio, state);
    expect(video.paused).toBe(false);
    expect(audio.play).toHaveBeenCalledOnce();
  });
  it('does not resume after the viewer explicitly cancels a buffering wait', () => {
    const { video, audio, state } = media();
    syncIndependentAudio(video, audio, state);
    state.waiting = false;
    Object.assign(audio, { readyState: 4 });
    syncIndependentAudio(video, audio, state);
    expect(video.paused).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
  });
  it('pauses audio for video buffering, seeking, user pause and end', () => {
    for (const change of [
      { paused: true },
      { ended: true },
      { seeking: true },
      { readyState: 1 },
      { readyState: 2 },
    ]) {
      const { video, audio, state } = media();
      Object.assign(video, change);
      Object.assign(audio, { paused: false });
      syncIndependentAudio(video, audio, state);
      expect(audio.pause).toHaveBeenCalledOnce();
      expect(audio.play).not.toHaveBeenCalled();
    }
  });
  it('does not restart an already synchronized, playing audio stream', () => {
    const { video, audio, state } = media();
    Object.assign(audio, { currentTime: 4.99, readyState: 4, paused: false });
    syncIndependentAudio(video, audio, state, true);
    expect(audio.currentTime).toBe(4.99);
    expect(audio.play).not.toHaveBeenCalled();
    expect(video.pause).not.toHaveBeenCalled();
  });
});
