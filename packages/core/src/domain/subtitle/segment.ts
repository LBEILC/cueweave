import { DEFAULT_SEGMENTATION_CONFIG } from './config';
import type { NormalizedCue, SegmentationConfig, SemanticSegment } from './types';

const STRONG_ENDING = /[.!?。！？…]["'”’）】》]*$/u;
const CJK_ENDING = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u;
const CJK_START = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const NO_LEADING_SPACE = /^[,.;:!?，。；：！？…）】》]/u;

function joinText(parts: readonly string[]): string {
  return parts.reduce((result, part) => {
    if (!result) return part;
    if (NO_LEADING_SPACE.test(part) || (CJK_ENDING.test(result) && CJK_START.test(part))) {
      return `${result}${part}`;
    }
    return `${result} ${part}`;
  }, '');
}

function toSegment(cues: readonly NormalizedCue[]): SemanticSegment {
  const first = cues[0];
  const last = cues.at(-1);
  if (!first || !last) {
    throw new Error('Cannot create a semantic segment from an empty cue list.');
  }

  const sourceCueIds = cues.flatMap((cue) => cue.sourceCueIds);
  return {
    id: `segment:${sourceCueIds[0]}:${sourceCueIds.at(-1)}`,
    sourceCueIds,
    startMs: first.startMs,
    endMs: last.endMs,
    sourceText: joinText(cues.map((cue) => cue.normalizedText)),
    translation: '',
    status: 'pending',
  };
}

export function segmentCues(
  cues: readonly NormalizedCue[],
  overrides: Partial<SegmentationConfig> = {},
): SemanticSegment[] {
  const config = { ...DEFAULT_SEGMENTATION_CONFIG, ...overrides };
  const segments: SemanticSegment[] = [];
  let current: NormalizedCue[] = [];

  const flush = () => {
    if (current.length > 0) {
      segments.push(toSegment(current));
      current = [];
    }
  };

  for (const cue of cues) {
    if (!cue.normalizedText || cue.isNoise) continue;

    const previous = current.at(-1);
    const first = current[0];
    const gapMs = previous ? cue.startMs - previous.endMs : 0;
    const wouldBeText = joinText([
      ...current.map((item) => item.normalizedText),
      cue.normalizedText,
    ]);
    const wouldExceedDuration = first ? cue.endMs - first.startMs > config.maxDurationMs : false;
    const wouldExceedCharacters = current.length > 0 && wouldBeText.length > config.maxCharacters;
    const hasTimelineDiscontinuity = previous ? cue.startMs < previous.startMs : false;
    const speakerChanged = Boolean(cue.speaker && current.length > 0);

    if (
      gapMs > config.pauseThresholdMs ||
      wouldExceedDuration ||
      wouldExceedCharacters ||
      hasTimelineDiscontinuity ||
      speakerChanged
    ) {
      flush();
    }

    current.push(cue);

    if (STRONG_ENDING.test(cue.normalizedText)) {
      flush();
    }
  }

  flush();
  return segments;
}
