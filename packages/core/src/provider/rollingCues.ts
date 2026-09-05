import type { TranslationCue } from './cueTranslation';

/** Remove WebVTT roll-up carry-over only where both text and overlapping time prove it. */
export function normalizeRollingCues(source: readonly TranslationCue[]): TranslationCue[] {
  const result: TranslationCue[] = [];
  for (const item of source) {
    const cue = { ...item };
    const previous = result.at(-1);
    if (previous && cue.startMs < previous.endMs) {
      if (previous.text === cue.text) {
        previous.endMs = Math.max(previous.endMs, cue.endMs);
        continue;
      }
      const before = previous.text.split('\n');
      const current = cue.text.split('\n');
      let overlap = Math.min(before.length, current.length);
      while (
        overlap > 0 &&
        before.slice(-overlap).join('\n') !== current.slice(0, overlap).join('\n')
      )
        overlap--;
      if (overlap > 0 && overlap < current.length) {
        cue.text = current.slice(overlap).join('\n');
        previous.endMs = Math.min(previous.endMs, cue.startMs);
      }
    }
    result.push(cue);
  }
  return result
    .filter((cue) => cue.endMs > cue.startMs)
    .map((cue, index) => ({ ...cue, id: String(index + 1) }));
}
