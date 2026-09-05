export type SubtitleDisplayMode = 'bilingual' | 'translation' | 'source';
export type BilingualOrder = 'translation-first' | 'source-first';

export interface SubtitlePreferences {
  displayMode: SubtitleDisplayMode;
  bilingualOrder: BilingualOrder;
  transcriptCorrectionEnabled: boolean;
  positionPercent: number;
  sizePercent: number;
  sourceSizePercent: number;
  backgroundEnabled: boolean;
  backgroundOpacityPercent: number;
  shadowEnabled: boolean;
  shadowStrengthPercent: number;
}

export const DEFAULT_SUBTITLE_PREFERENCES: Readonly<SubtitlePreferences> = {
  displayMode: 'bilingual',
  bilingualOrder: 'translation-first',
  transcriptCorrectionEnabled: true,
  positionPercent: 9,
  sizePercent: 100,
  sourceSizePercent: 68,
  backgroundEnabled: true,
  backgroundOpacityPercent: 80,
  shadowEnabled: true,
  shadowStrengthPercent: 80,
};

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback;
}

export function parseSubtitlePreferences(value: unknown): SubtitlePreferences {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

  return {
    displayMode:
      record.displayMode === 'translation' || record.displayMode === 'source'
        ? record.displayMode
        : 'bilingual',
    bilingualOrder: record.bilingualOrder === 'source-first' ? 'source-first' : 'translation-first',
    transcriptCorrectionEnabled:
      typeof record.transcriptCorrectionEnabled === 'boolean'
        ? record.transcriptCorrectionEnabled
        : DEFAULT_SUBTITLE_PREFERENCES.transcriptCorrectionEnabled,
    positionPercent: clampNumber(
      record.positionPercent,
      DEFAULT_SUBTITLE_PREFERENCES.positionPercent,
      4,
      28,
    ),
    sizePercent: clampNumber(record.sizePercent, DEFAULT_SUBTITLE_PREFERENCES.sizePercent, 75, 150),
    sourceSizePercent: clampNumber(
      record.sourceSizePercent,
      DEFAULT_SUBTITLE_PREFERENCES.sourceSizePercent,
      50,
      150,
    ),
    backgroundEnabled:
      typeof record.backgroundEnabled === 'boolean'
        ? record.backgroundEnabled
        : DEFAULT_SUBTITLE_PREFERENCES.backgroundEnabled,
    backgroundOpacityPercent:
      Math.round(
        clampNumber(
          record.backgroundOpacityPercent,
          DEFAULT_SUBTITLE_PREFERENCES.backgroundOpacityPercent,
          10,
          95,
        ) / 5,
      ) * 5,
    shadowEnabled:
      typeof record.shadowEnabled === 'boolean'
        ? record.shadowEnabled
        : DEFAULT_SUBTITLE_PREFERENCES.shadowEnabled,
    shadowStrengthPercent:
      Math.round(
        clampNumber(
          record.shadowStrengthPercent,
          DEFAULT_SUBTITLE_PREFERENCES.shadowStrengthPercent,
          0,
          100,
        ) / 5,
      ) * 5,
  };
}
