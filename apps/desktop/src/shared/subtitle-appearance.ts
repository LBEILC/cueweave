import {
  parseSubtitlePreferences,
  type SubtitlePreferences,
} from '@cueweave/core/settings/subtitle';

export type SubtitleAppearance = Omit<SubtitlePreferences, 'transcriptCorrectionEnabled'>;
export function parseSubtitleAppearance(value: unknown): SubtitleAppearance {
  const { transcriptCorrectionEnabled: _unused, ...appearance } = parseSubtitlePreferences(value);
  void _unused;
  return appearance;
}
export const DEFAULT_SUBTITLE_APPEARANCE = parseSubtitleAppearance(undefined);
export function validSubtitleAppearance(value: unknown): value is SubtitleAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const normalized = parseSubtitleAppearance(value);
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === Object.keys(normalized).length &&
    Object.entries(normalized).every(([key, v]) => record[key] === v)
  );
}
