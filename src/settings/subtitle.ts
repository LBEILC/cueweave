export type SubtitleDisplayMode = 'bilingual' | 'translation' | 'source';
export type BilingualOrder = 'translation-first' | 'source-first';

export interface SubtitlePreferences {
  displayMode: SubtitleDisplayMode;
  bilingualOrder: BilingualOrder;
  positionPercent: number;
  sizePercent: number;
  backgroundEnabled: boolean;
  backgroundOpacityPercent: number;
}

export const SUBTITLE_PREFERENCES_KEY = 'cueweave.subtitle-preferences';

export const DEFAULT_SUBTITLE_PREFERENCES: Readonly<SubtitlePreferences> = {
  displayMode: 'bilingual',
  bilingualOrder: 'translation-first',
  positionPercent: 9,
  sizePercent: 100,
  backgroundEnabled: true,
  backgroundOpacityPercent: 80,
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
    positionPercent: clampNumber(
      record.positionPercent,
      DEFAULT_SUBTITLE_PREFERENCES.positionPercent,
      4,
      28,
    ),
    sizePercent: clampNumber(record.sizePercent, DEFAULT_SUBTITLE_PREFERENCES.sizePercent, 75, 150),
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
  };
}

export async function readSubtitlePreferences(): Promise<SubtitlePreferences> {
  const stored = await browser.storage.local.get([SUBTITLE_PREFERENCES_KEY]);
  return parseSubtitlePreferences(stored[SUBTITLE_PREFERENCES_KEY]);
}

export async function saveSubtitlePreferences(value: unknown): Promise<SubtitlePreferences> {
  const preferences = parseSubtitlePreferences(value);
  await browser.storage.local.set({ [SUBTITLE_PREFERENCES_KEY]: preferences });
  return preferences;
}
