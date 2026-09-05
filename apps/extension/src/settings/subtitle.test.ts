import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SUBTITLE_PREFERENCES,
  parseSubtitlePreferences,
  readSubtitlePreferences,
  saveSubtitlePreferences,
  saveSubtitleDisplayMode,
} from './subtitle';

describe('subtitle preferences', () => {
  it('uses stable defaults for missing settings', () => {
    expect(parseSubtitlePreferences(undefined)).toEqual(DEFAULT_SUBTITLE_PREFERENCES);
  });

  it('normalizes modes and clamps visual ranges', () => {
    expect(
      parseSubtitlePreferences({
        displayMode: 'translation',
        bilingualOrder: 'source-first',
        positionPercent: 99,
        sizePercent: 40,
        backgroundEnabled: false,
        backgroundOpacityPercent: 100,
      }),
    ).toEqual({
      displayMode: 'translation',
      bilingualOrder: 'source-first',
      transcriptCorrectionEnabled: true,
      positionPercent: 28,
      sizePercent: 75,
      sourceSizePercent: 68,
      backgroundEnabled: false,
      backgroundOpacityPercent: 95,
      shadowEnabled: true,
      shadowStrengthPercent: 80,
    });
  });

  it('supports source-only display and rejects unknown language orders', () => {
    expect(
      parseSubtitlePreferences({ displayMode: 'source', bilingualOrder: 'unknown' }),
    ).toMatchObject({
      displayMode: 'source',
      bilingualOrder: 'translation-first',
    });
  });

  it('aligns background opacity to the five-percent control step', () => {
    expect(
      parseSubtitlePreferences({ backgroundOpacityPercent: 82 }).backgroundOpacityPercent,
    ).toBe(80);
  });

  it('adds shadow defaults to older preferences without resetting existing display choices', () => {
    expect(
      parseSubtitlePreferences({ displayMode: 'source', backgroundEnabled: false }),
    ).toMatchObject({
      displayMode: 'source',
      backgroundEnabled: false,
      shadowEnabled: true,
      shadowStrengthPercent: 80,
    });
  });

  it.each([
    [-10, 0],
    [0, 0],
    [38, 40],
    [100, 100],
    [130, 100],
    [NaN, 80],
    [Infinity, 80],
    ['50', 80],
  ])('normalizes shadow strength %s to %s', (value, expected) => {
    expect(parseSubtitlePreferences({ shadowStrengthPercent: value }).shadowStrengthPercent).toBe(
      expected,
    );
  });

  it('keeps shadow strength when its switch is off and ignores malformed switch values', () => {
    expect(
      parseSubtitlePreferences({ shadowEnabled: false, shadowStrengthPercent: 35 }),
    ).toMatchObject({
      shadowEnabled: false,
      shadowStrengthPercent: 35,
    });
    expect(parseSubtitlePreferences({ shadowEnabled: 'false' }).shadowEnabled).toBe(true);
  });

  it('preserves the existing source-to-translation scale for older saved preferences', () => {
    expect(parseSubtitlePreferences({ displayMode: 'bilingual', sizePercent: 120 })).toMatchObject({
      sizePercent: 120,
      sourceSizePercent: 68,
    });
  });

  it.each([
    [50, 50],
    [100, 100],
    [150, 150],
    [20, 50],
    [200, 150],
    [83.7, 84],
    [NaN, 68],
    [Infinity, 68],
    ['120', 68],
    [null, 68],
  ])('normalizes the source size ratio %s to %s', (value, expected) => {
    expect(parseSubtitlePreferences({ sourceSizePercent: value }).sourceSizePercent).toBe(expected);
  });

  it('retains the ratio independently of language order and single-language mode', () => {
    for (const displayMode of ['source', 'translation', 'bilingual']) {
      for (const bilingualOrder of ['translation-first', 'source-first']) {
        expect(
          parseSubtitlePreferences({ displayMode, bilingualOrder, sourceSizePercent: 125 }),
        ).toMatchObject({ displayMode, bilingualOrder, sourceSizePercent: 125 });
      }
    }
  });

  it('saves and restores the ratio with the other display preferences', async () => {
    const stored: Record<string, unknown> = {};
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: async () => stored,
          set: async (values: Record<string, unknown>) => Object.assign(stored, values),
        },
      },
    });
    try {
      await saveSubtitlePreferences({
        ...DEFAULT_SUBTITLE_PREFERENCES,
        sourceSizePercent: 125,
        bilingualOrder: 'source-first',
        shadowEnabled: false,
        shadowStrengthPercent: 35,
      });
      const preferences = await readSubtitlePreferences();
      expect(preferences).toMatchObject({
        sourceSizePercent: 125,
        bilingualOrder: 'source-first',
        shadowEnabled: false,
        shadowStrengthPercent: 35,
      });
      for (const displayMode of ['source', 'translation', 'bilingual'] as const) {
        await saveSubtitleDisplayMode(displayMode);
        expect(await readSubtitlePreferences()).toEqual({ ...preferences, displayMode });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
