import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBTITLE_PREFERENCES, parseSubtitlePreferences } from './subtitle';

describe('subtitle preferences', () => {
  it('uses stable defaults for missing settings', () => {
    expect(parseSubtitlePreferences(undefined)).toEqual(DEFAULT_SUBTITLE_PREFERENCES);
  });

  it('normalizes modes and clamps visual ranges', () => {
    expect(
      parseSubtitlePreferences({
        displayMode: 'translation',
        positionPercent: 99,
        sizePercent: 40,
        backgroundEnabled: false,
        backgroundOpacityPercent: 100,
      }),
    ).toEqual({
      displayMode: 'translation',
      positionPercent: 28,
      sizePercent: 75,
      backgroundEnabled: false,
      backgroundOpacityPercent: 95,
    });
  });

  it('aligns background opacity to the five-percent control step', () => {
    expect(
      parseSubtitlePreferences({ backgroundOpacityPercent: 82 }).backgroundOpacityPercent,
    ).toBe(80);
  });
});
