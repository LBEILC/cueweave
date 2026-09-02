import { deduplicateRollingCues } from './dedupe';
import { normalizeCues } from './normalize';
import { segmentCues } from './segment';
import type { PipelineOptions, RawCue, SemanticSegment } from './types';

export function processSubtitleCues(
  cues: readonly RawCue[],
  options: PipelineOptions = {},
): SemanticSegment[] {
  const normalized = normalizeCues(cues);
  const deduplicated = deduplicateRollingCues(normalized);
  const candidates = options.includeNoise
    ? deduplicated.map((cue) => (cue.isNoise ? { ...cue, isNoise: false } : cue))
    : deduplicated;

  return segmentCues(candidates, options.segmentation);
}
