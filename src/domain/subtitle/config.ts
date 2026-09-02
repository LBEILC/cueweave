import type { SegmentationConfig } from './types';

export const DEFAULT_SEGMENTATION_CONFIG: Readonly<SegmentationConfig> = {
  maxDurationMs: 15_000,
  maxCharacters: 220,
  pauseThresholdMs: 1_000,
};

export const ROLLING_CUE_MAX_GAP_MS = 3_000;
