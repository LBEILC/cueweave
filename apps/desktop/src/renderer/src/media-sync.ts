export interface AudioSyncState {
  waiting: boolean;
}

/** Freeze the master clock while the separate audio stream buffers or finishes a seek. */
export function syncIndependentAudio(
  video: HTMLVideoElement,
  audio: HTMLAudioElement,
  state: AudioSyncState,
  force = false,
) {
  if (video.ended) state.waiting = false;
  if ((video.paused && !state.waiting) || video.ended || video.seeking || video.readyState < 3) {
    if (!audio.paused) audio.pause();
    return;
  }
  audio.playbackRate = video.playbackRate;
  const wait = () => {
    state.waiting = true;
    if (!video.paused) video.pause();
    if (!audio.paused) audio.pause();
  };
  // A moving target repeatedly invalidates remote buffers. Hold both clocks until data arrives.
  if (audio.readyState < 3 || audio.seeking) {
    wait();
    return;
  }
  if (Math.abs(audio.currentTime - video.currentTime) > (force ? 0.05 : 0.3)) {
    wait();
    audio.currentTime = video.currentTime;
    if (audio.seeking || audio.readyState < 3) return;
  }
  if (state.waiting) {
    state.waiting = false;
    void video.play().catch(() => {});
  }
  if (audio.paused) void audio.play().catch(() => {});
}
