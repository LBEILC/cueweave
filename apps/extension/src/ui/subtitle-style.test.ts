import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBTITLE_PREFERENCES } from '../settings/subtitle';
import { subtitleTextShadow } from './subtitle-style';

describe('subtitle shadow', () => {
  it.each([true, false])(
    'removes all shadow layers with backing %s when disabled or zero',
    (backgroundEnabled) => {
      const preferences = { ...DEFAULT_SUBTITLE_PREFERENCES, backgroundEnabled };
      expect(subtitleTextShadow({ ...preferences, shadowEnabled: false })).toBe('none');
      expect(subtitleTextShadow({ ...preferences, shadowStrengthPercent: 0 })).toBe('none');
    },
  );

  it('preserves the existing backed and unbacked defaults', () => {
    expect(subtitleTextShadow(DEFAULT_SUBTITLE_PREFERENCES)).toBe('0 2px 3px rgb(0 0 0 / 0.8)');
    expect(subtitleTextShadow({ ...DEFAULT_SUBTITLE_PREFERENCES, backgroundEnabled: false })).toBe(
      '0 1px 2px rgb(0 0 0 / 1), 0 2px 4px rgb(0 0 0 / 1)',
    );
  });

  it('softens both unbacked layers at lower strength', () => {
    expect(
      subtitleTextShadow({
        ...DEFAULT_SUBTITLE_PREFERENCES,
        backgroundEnabled: false,
        shadowStrengthPercent: 40,
      }),
    ).toBe('0 1px 2px rgb(0 0 0 / 0.5), 0 2px 4px rgb(0 0 0 / 0.5)');
  });
});
