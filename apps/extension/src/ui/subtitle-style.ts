import type { SubtitlePreferences } from '../settings/subtitle';

export function subtitleTextShadow(preferences: SubtitlePreferences): string {
  if (!preferences.shadowEnabled || preferences.shadowStrengthPercent === 0) return 'none';
  const strength = preferences.shadowStrengthPercent / 100;
  if (preferences.backgroundEnabled) return `0 2px 3px rgb(0 0 0 / ${strength})`;
  const alpha = Math.min(1, strength * 1.25);
  return `0 1px 2px rgb(0 0 0 / ${alpha}), 0 2px 4px rgb(0 0 0 / ${alpha})`;
}
