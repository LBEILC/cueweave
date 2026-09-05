import { describe, expect, it, vi } from 'vitest';
import type { SourceToken } from '../domain/subtitle/types';
import { extractUnitTechnicalEntities } from '../domain/subtitle/evidence';
import { extractTranscriptEntityCandidates } from '../domain/subtitle/entities';
import { translateFirstPass, buildFirstPassPrompt } from './firstPass';
import { PlaybackPlan } from './playbackPlan';
import { PartialTranslationError, translatePlaybackWindow } from './chatCompletions';

const tokens = (text: string): SourceToken[] =>
  text.split(' ').map((text, i) => ({
    id: `t${i}`,
    cueId: 'c',
    text,
    startMs: i * 1000,
    endMs: (i + 1) * 1000,
  }));
const output = (units: Array<[number, number, string]>) =>
  JSON.stringify({
    units: units.map(([startIndex, endIndex, translation]) => ({
      startIndex,
      endIndex,
      translation,
      sentenceEnd: true,
    })),
    corrections: [],
    terminology: [],
  });

describe('playback quality / speed tradeoff', () => {
  it('still blocks changed or missing dimensions and does not accept numeric hallucinations', async () => {
    for (const [source, translation] of [
      ['28x28', '28×29'],
      ['28x28', '像素'],
      ['pixels', '28×28像素'],
    ]) {
      const request = vi.fn().mockResolvedValue(output([[0, 0, translation!]]));
      const result = await translateFirstPass(tokens(source!), {}, {}, request);
      expect(result.cues).toEqual([]);
      expect(result.missingTokenIds).toEqual(['t0']);
    }
  });
  it.each(['28x28', '28×28', '28乘28'])(
    'accepts equivalent dimensions %s in one call',
    async (translation) => {
      const request = vi.fn().mockResolvedValue(output([[0, 0, `${translation}像素`]]));
      const result = await translateFirstPass(tokens('28x28'), {}, {}, request);
      expect(result.missingTokenIds).toEqual([]);
      expect(request).toHaveBeenCalledOnce();
    },
  );
  it('does not classify dimensions as model names or relax actual entity checks', () => {
    expect(extractUnitTechnicalEntities('28x28 3.5×4.5 GPT-5.6 X28 model Astra')).toEqual(
      expect.arrayContaining(['GPT-5.6', 'X28', 'Astra']),
    );
    expect(extractUnitTechnicalEntities('28x28 3.5×4.5')).toEqual([]);
    expect(
      extractTranscriptEntityCandidates(tokens('28x28 28x28 GPT-5.6')).map((c) => c.observed),
    ).toEqual(['GPT-5.6']);
  });
  it('speed uses a shorter prompt and retains essential context and semantic constraints', () => {
    const source = tokens('If you have not eaten you may wait');
    const context = { terminology: [{ source: 'Astra', translation: 'Astra' }] };
    const speed = buildFirstPassPrompt(
      source,
      { ...context, translationMode: 'speed' },
      { after: 'Next sentence' },
    );
    expect(speed.length).toBeLessThan(buildFirstPassPrompt(source, context, {}).length);
    expect(speed).toContain('否定');
    expect(speed).toContain('Astra');
    expect(speed).toContain('Next sentence');
  });
  it.each(['speed', 'balanced'] as const)(
    '%s does not add review calls to valid output',
    async (translationMode) => {
      const request = vi.fn().mockResolvedValue(output([[0, 0, '你好']]));
      expect(
        (await translateFirstPass(tokens('Hello'), { translationMode }, {}, request))
          .firstPassComplete,
      ).toBe(true);
      expect(request).toHaveBeenCalledOnce();
    },
  );
  it.each([
    ['speed', 2, ['t1']],
    ['balanced', 3, []],
  ] as const)(
    '%s has bounded recovery and preserves accepted cues',
    async (translationMode, calls, missing) => {
      const request = vi
        .fn()
        .mockResolvedValueOnce('{}')
        .mockResolvedValueOnce(
          output([
            [0, 0, '你好'],
            [1, 1, 'GPT-4o'],
          ]),
        )
        .mockResolvedValueOnce(JSON.stringify({ translations: [{ id: 1, translation: 'Astra' }] }));
      const result = await translateFirstPass(
        tokens('Hello Astra'),
        { translationMode },
        {},
        request,
      );
      expect(request).toHaveBeenCalledTimes(calls);
      expect(result.cues[0]?.translation).toBe('你好');
      expect(result.missingTokenIds).toEqual(missing);
    },
  );
  it('speed finalizes local windows without a model planning request, including out-of-order seeks', async () => {
    const source = tokens(Array.from({ length: 100 }, (_, i) => `word${i}`).join(' '));
    const plan = new PlaybackPlan(source, undefined, 'speed');
    const request = vi.fn();
    await Promise.all([plan.prepare(1, request), plan.prepare(0, request)]);
    expect(request).not.toHaveBeenCalled();
    expect(plan.snapshot().finalized.slice(0, 2)).toEqual([true, true]);
    expect(plan.snapshot().ends.at(-1)).toBe(source.length);
  });
  it('provider exposes accepted cues on partial failure rather than claiming completion', async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: output([
                    [0, 0, '你好'],
                    [1, 1, 'GPT-4o'],
                  ]),
                },
              },
            ],
          }),
        ),
    );
    const job = translatePlaybackWindow(
      {
        baseUrl: 'https://test.invalid/v1',
        apiKey: 'test',
        model: 'test',
        protocol: 'chat-completions',
      },
      tokens('Hello Astra'),
      undefined,
      undefined,
      {},
      undefined,
      { fetch: fetchMock },
    );
    await expect(job).rejects.toBeInstanceOf(PartialTranslationError);
    await expect(job).rejects.toMatchObject({
      cues: [expect.objectContaining({ translation: '你好' })],
      missingTokenIds: ['t1'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
