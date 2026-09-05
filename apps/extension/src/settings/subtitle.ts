import {
  parseSubtitlePreferences,
  type SubtitlePreferences,
  type SubtitleDisplayMode,
} from '@cueweave/core/settings/subtitle';
export * from '@cueweave/core/settings/subtitle';

export const SUBTITLE_PREFERENCES_KEY = 'cueweave.subtitle-preferences';

export async function readSubtitlePreferences(): Promise<SubtitlePreferences> {
  const stored = await browser.storage.local.get([SUBTITLE_PREFERENCES_KEY]);
  return parseSubtitlePreferences(stored[SUBTITLE_PREFERENCES_KEY]);
}

export async function saveSubtitlePreferences(value: unknown): Promise<SubtitlePreferences> {
  const preferences = parseSubtitlePreferences(value);
  await browser.storage.local.set({ [SUBTITLE_PREFERENCES_KEY]: preferences });
  return preferences;
}

export async function saveSubtitleDisplayMode(
  displayMode: SubtitleDisplayMode,
): Promise<SubtitlePreferences> {
  const preferences = await readSubtitlePreferences();
  return saveSubtitlePreferences({ ...preferences, displayMode });
}
