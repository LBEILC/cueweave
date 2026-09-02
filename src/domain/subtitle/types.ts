export interface RawCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface NormalizedCue extends RawCue {
  normalizedText: string;
  sourceCueIds: string[];
  speaker?: string;
  isNoise: boolean;
}

export type SegmentStatus = 'pending' | 'translated' | 'fallback' | 'failed';

export interface SemanticSegment {
  id: string;
  sourceCueIds: string[];
  startMs: number;
  endMs: number;
  sourceText: string;
  translation: string;
  status: SegmentStatus;
}

export interface SegmentationConfig {
  maxDurationMs: number;
  maxCharacters: number;
  pauseThresholdMs: number;
}

export interface PipelineOptions {
  segmentation?: Partial<SegmentationConfig>;
  includeNoise?: boolean;
}
