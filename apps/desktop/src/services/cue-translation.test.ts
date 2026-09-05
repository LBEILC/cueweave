import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  boundedProviderFetch,
  parseCueTranslation,
  translationWindows,
  translateCueWindow,
} from './cue-translation';
import { isProjectCommand } from '../shared/project';
import {
  DEFAULT_SUBTITLE_APPEARANCE,
  validSubtitleAppearance,
} from '../shared/subtitle-appearance';
import { isSettingsCommand } from '../shared/settings';

const cues = [
  { id: 'c1', startMs: 150, endMs: 1000, text: 'Do not stop.' },
  { id: 'c2', startMs: 900, endMs: 2200, text: 'Again, again.' },
];
afterEach(() => vi.unstubAllGlobals());
describe('cue-preserving desktop translation', () => {
  it('requires exact ordered coverage, nonempty plain text, and no model timestamps', () => {
    const units = [
      { id: 'c1', translation: '不要停下。' },
      { id: 'c2', translation: '再来，再来。' },
    ];
    expect(parseCueTranslation(JSON.stringify({ cues: units }), cues)).toEqual(units);
    for (const value of [
      [],
      units.slice(0, 1),
      [...units, units[0]],
      [...units].reverse(),
      [units[0], units[0]],
      [{ ...units[0], startMs: 0 }, units[1]],
      [{ ...units[0], translation: ' ' }, units[1]],
      [{ ...units[0], translation: 'a\n\nb' }, units[1]],
      [{ ...units[0], translation: '\u0000' }, units[1]],
    ])
      expect(() => parseCueTranslation(JSON.stringify({ cues: value }), cues)).toThrow();
    expect(() => parseCueTranslation(JSON.stringify({ cues: units, extra: true }), cues)).toThrow();
    expect(cues[0]?.startMs).toBe(150);
  });
  it('bounds windows without splitting cue time or removing repeated speech', () => {
    const input = Array.from({ length: 51 }, (_, index) => ({
      ...cues[index % 2]!,
      id: `id${index}`,
      text: 'again '.repeat(80),
    }));
    const windows = translationWindows(input);
    expect(windows.flat()).toEqual(input);
    expect(
      windows.every((w) => w.length <= 20 && w.reduce((n, c) => n + c.text.length, 0) <= 6000),
    ).toBe(true);
  });
  it('rejects credentials, private worker commands, and foreign export shapes over the bridge', () => {
    const base = { projectId: 'p', baseRevision: 2 };
    expect(isProjectCommand({ action: 'translate', ...base, language: 'zh-CN' })).toBe(true);
    expect(
      isProjectCommand({ action: 'translate', ...base, language: 'zh-CN', apiKey: 'secret' }),
    ).toBe(false);
    expect(isProjectCommand({ action: 'translation-commit', ...base, units: [] })).toBe(false);
    expect(
      isProjectCommand({
        action: 'export',
        ...base,
        format: 'srt',
        original: true,
        mode: 'bilingual',
      }),
    ).toBe(false);
    expect(
      isProjectCommand({
        action: 'export',
        ...base,
        format: 'srt',
        original: false,
        mode: 'bilingual',
        partial: true,
      }),
    ).toBe(true);
  });
  it('validates all persisted display fields at the settings boundary', () => {
    expect(validSubtitleAppearance(DEFAULT_SUBTITLE_APPEARANCE)).toBe(true);
    for (const patch of [
      { sizePercent: 500 },
      { positionPercent: NaN },
      { displayMode: 'html' },
      { backgroundEnabled: 'yes' },
      { css: 'url(private)' },
    ])
      expect(
        isSettingsCommand({
          action: 'subtitles',
          subtitles: { ...DEFAULT_SUBTITLE_APPEARANCE, ...patch },
        }),
      ).toBe(false);
  });
  it('bounds network responses and refuses credentials at another origin', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1)));
    vi.stubGlobal('fetch', fetch);
    const safe = boundedProviderFetch('https://provider.test/v1', new AbortController().signal);
    await expect(safe('https://other.test/v1')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(safe('https://provider.test/v1/chat/completions')).rejects.toThrow(
      'Response too large',
    );
    expect(fetch.mock.calls[0]?.[1].redirect).toBe('error');
  });
  it('retries invalid output once and sends only requested cue IDs plus bounded context', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        const content =
          bodies.length === 1
            ? '{"cues":[]}'
            : JSON.stringify({
                cues: [
                  { id: 'c1', translation: '不要停下。' },
                  { id: 'c2', translation: '再来，再来。' },
                ],
              });
        return new Response(
          JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
    const result = await translateCueWindow(
      {
        baseUrl: 'https://provider.test/v1',
        model: 'fixture',
        protocol: 'chat-completions',
        apiKey: 'unit-only',
      },
      cues,
      cues,
      'zh-CN',
      new AbortController().signal,
    );
    expect(result).toHaveLength(2);
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies)).not.toContain('startMs');
    expect(JSON.stringify(bodies)).not.toContain('unit-only');
  });
});
