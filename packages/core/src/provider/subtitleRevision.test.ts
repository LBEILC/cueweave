import { describe, expect, it, vi } from 'vitest';
import { translateFirstPass } from './firstPass';
import type { SourceToken } from '../domain/subtitle/types';

const tokens = (text: string): SourceToken[] =>
  text.split(' ').map((text, i) => ({
    id: `t${i}`,
    cueId: 'c',
    text,
    startMs: i * 400,
    endMs: (i + 1) * 400,
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

describe('bounded source-grounded revision', () => {
  it('keeps the Chinese draft when a cited revision copies the English sentence back', async () => {
    const source = 'Where can we buy tickets?';
    const request = vi
      .fn()
      .mockResolvedValueOnce(output([[0, 4, '我们可以在哪里购票']]))
      .mockResolvedValueOnce(
        JSON.stringify({
          edits: [
            {
              id: 0,
              sourceQuote: source,
              problem: '修改问句',
              translation: source,
            },
          ],
        }),
      );
    const result = await translateFirstPass(
      tokens(source),
      { translationMode: 'quality' },
      {},
      request,
    );
    expect(result.reviewStatus).toBe('failed');
    expect(result.cues[0]!.translation).toBe('我们可以在哪里购票');
    expect(result.missingTokenIds).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('quality compares explicit source ranges and retains their fixed ownership', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        output([
          [0, 5, '如果你已经吃完饭'],
          [6, 6, '请等待'],
        ]),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          edits: [
            {
              id: 0,
              sourceQuote: 'not eaten',
              problem: '否定被翻为肯定',
              translation: '如果你还没吃饭请等待',
            },
          ],
        }),
      );
    const result = await translateFirstPass(
      tokens('If you have not eaten yet wait'),
      { translationMode: 'quality' },
      {},
      request,
    );
    expect(request.mock.calls.map((c) => c[0])).toEqual(['first-pass', 'quality-revision']);
    expect(result.cues.map((c) => c.translation)).toEqual(['如果你还没吃饭请等待']);
    expect(result.cues.flatMap((c) => c.sourceTokenIds)).toEqual(
      Array.from({ length: 7 }, (_, i) => `t${i}`),
    );
    expect(result.reviewStatus).toBe('accepted');
  });
  it.each([
    'not JSON',
    JSON.stringify({ translations: [{ id: 0, translation: 'GPT-4o' }] }),
    JSON.stringify({ translations: [{ id: 1, translation: '你好' }] }),
  ])('retains the draft when quality revision is invalid', async (revision) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(output([[0, 0, '你好']]))
      .mockResolvedValueOnce(revision);
    const result = await translateFirstPass(
      tokens('Hello'),
      { translationMode: 'quality' },
      {},
      request,
    );
    expect(result.cues[0]?.translation).toBe('你好');
    expect(result.reviewStatus).toBe('failed');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('does not discard partial accepted cues when revision transport also fails', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        output([
          [0, 0, '你好'],
          [1, 1, 'GPT-4o'],
        ]),
      )
      .mockRejectedValue(new Error('offline'));
    const result = await translateFirstPass(
      tokens('Hello Astra'),
      { translationMode: 'quality' },
      {},
      request,
    );
    expect(result.cues.map((c) => c.translation)).toEqual(['你好']);
    expect(result.missingTokenIds).toEqual(['t1']);
    expect(result.reviewStatus).toBe('failed');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it.each(['speed', 'balanced'] as const)(
    '%s leaves an ordinary valid draft at one request',
    async (translationMode) => {
      const request = vi.fn().mockResolvedValue(output([[0, 0, '你好']]));
      expect(
        (await translateFirstPass(tokens('Hello'), { translationMode }, {}, request)).reviewStatus,
      ).toBe('skipped');
      expect(request).toHaveBeenCalledOnce();
    },
  );
  it('balanced repairs suspected cross-cue duplication once without making it a hard validation failure', async () => {
    const initial = output([
      [0, 1, '我们需要了解免疫系统如何保护身体'],
      [2, 3, '了解免疫系统如何保护身体'],
    ]);
    const request = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(
        JSON.stringify({
          edits: [
            {
              id: 0,
              sourceQuote: 'Understand defenses against illness',
              problem: '草稿重复表达',
              translation: '了解如何抵御疾病',
            },
          ],
        }),
      );
    const result = await translateFirstPass(
      tokens('Understand defenses against illness'),
      { translationMode: 'balanced' },
      {},
      request,
    );
    expect(request.mock.calls.map((c) => c[0])).toEqual(['first-pass', 'risk-revision']);
    expect(result.reviewStatus).toBe('accepted');
    expect(result.missingTokenIds).toEqual([]);
  });
});

it('does not carry a rejected name into recovery as a nearby translation', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(output([[0, 2, '许多版本的 Sora']]))
    .mockResolvedValueOnce(
      JSON.stringify({ translations: [{ id: 0, translation: '许多版本的 Soul' }] }),
    );
  const result = await translateFirstPass(
    tokens('Many versions Soul'),
    { translationMode: 'speed' },
    {},
    request,
  );
  expect(result.missingTokenIds).toEqual([]);
  const prompt = request.mock.calls[1]![1] as string;
  const data = JSON.parse(prompt.split('\n').at(-1)!);
  expect(data.nearby[0].translation).toBeUndefined();
  expect(data.targets[0].source).toBe('Many versions Soul');
});

it('joins an unfinished predicate to its preposition without losing source ownership', async () => {
  const source = tokens('Our immune system defends us against infections');
  const request = vi.fn().mockResolvedValue(
    output([
      [0, 4, '我们的免疫系统保护我们'],
      [5, 6, '抵御感染'],
    ]),
  );
  const result = await translateFirstPass(source, { translationMode: 'speed' }, {}, request);
  expect(result.cues).toHaveLength(1);
  expect(result.cues[0]!.sourceTokenIds).toEqual(source.map((t) => t.id));
  expect(result.cues[0]!.endMs).toBe(source.at(-1)!.endMs);
});
