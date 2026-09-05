export interface TimedWord {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface RawCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  words?: TimedWord[];
}

export interface NormalizedCue extends RawCue {
  normalizedText: string;
  sourceCueIds: string[];
  speaker?: string;
  isNoise: boolean;
}

export type SegmentStatus = 'pending' | 'translated' | 'fallback' | 'failed';

export interface SourceToken extends TimedWord {
  cueId: string;
}

export interface TokenWindow {
  id: string;
  startMs: number;
  endMs: number;
  tokens: SourceToken[];
}

export type TranscriptCorrectionCategory = 'proper-noun' | 'asr-error' | 'formatting' | 'other';

export interface TranscriptCorrection {
  id: string;
  startIndex: number;
  endIndex: number;
  sourceTokenIds: string[];
  startMs: number;
  endMs: number;
  originalText: string;
  correctedText: string;
  confidence: number;
  category: TranscriptCorrectionCategory;
  applied: boolean;
}

export interface TranslationTerm {
  source: string;
  translation: string;
}

export interface SemanticSegment {
  id: string;
  sourceCueIds: string[];
  startMs: number;
  endMs: number;
  sourceText: string;
  translation: string;
  status: SegmentStatus;
}

export interface DisplayCue {
  id: string;
  sourceTokenIds: string[];
  startMs: number;
  endMs: number;
  sourceText: string;
  originalText?: string;
  corrections?: TranscriptCorrection[];
  terminology?: TranslationTerm[];
  translation: string;
  sentenceEnd: boolean;
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
