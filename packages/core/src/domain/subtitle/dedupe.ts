import { ROLLING_CUE_MAX_GAP_MS } from './config';
import type { NormalizedCue } from './types';

function tokenize(value: string): string[] {
  return value.split(/\s+/u).filter(Boolean);
}

function removeTokenOverlap(previous: string, current: string): string {
  const previousTokens = tokenize(previous);
  const currentTokens = tokenize(current);
  const maxOverlap = Math.min(previousTokens.length, currentTokens.length);

  for (let length = maxOverlap; length > 0; length -= 1) {
    const suffix = previousTokens.slice(-length).join(' ').toLocaleLowerCase();
    const prefix = currentTokens.slice(0, length).join(' ').toLocaleLowerCase();
    if (suffix === prefix) {
      return currentTokens.slice(length).join(' ');
    }
  }

  return current;
}

function appendSourceCue(target: NormalizedCue, cue: NormalizedCue): void {
  target.sourceCueIds.push(...cue.sourceCueIds);
  target.endMs = Math.max(target.endMs, cue.endMs);
}

export function deduplicateRollingCues(cues: readonly NormalizedCue[]): NormalizedCue[] {
  const output: NormalizedCue[] = [];
  let previousFullText = '';
  let previousEndMs = Number.NEGATIVE_INFINITY;
  let previousSpeaker: string | undefined;

  for (const cue of cues) {
    const current = { ...cue, sourceCueIds: [...cue.sourceCueIds] };
    const closeInTime = current.startMs - previousEndMs <= ROLLING_CUE_MAX_GAP_MS;
    const sameSpeakerContext = !current.speaker && !previousSpeaker;
    const canCompare =
      closeInTime && sameSpeakerContext && !current.isNoise && current.normalizedText.length > 0;

    let deduplicatedText = current.normalizedText;

    if (canCompare && previousFullText) {
      const previousFolded = previousFullText.toLocaleLowerCase();
      const currentFolded = current.normalizedText.toLocaleLowerCase();

      if (currentFolded === previousFolded || previousFolded.startsWith(currentFolded)) {
        const target = output.at(-1);
        if (target) {
          appendSourceCue(target, current);
        }
        previousFullText = current.normalizedText;
        previousEndMs = current.endMs;
        previousSpeaker = current.speaker;
        continue;
      }

      if (currentFolded.startsWith(previousFolded)) {
        deduplicatedText = current.normalizedText.slice(previousFullText.length).trim();
      } else {
        deduplicatedText = removeTokenOverlap(previousFullText, current.normalizedText).trim();
      }
    }

    if (deduplicatedText) {
      output.push({ ...current, normalizedText: deduplicatedText });
    } else {
      const target = output.at(-1);
      if (target) {
        appendSourceCue(target, current);
      }
    }

    previousFullText = current.normalizedText;
    previousEndMs = current.endMs;
    previousSpeaker = current.speaker;
  }

  return output;
}
