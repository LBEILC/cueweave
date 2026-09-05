import { describe, expect, it, vi } from 'vitest';
import { buildFirstPassPrompt, translateFirstPass } from './firstPass';
import type { SourceToken } from '../domain/subtitle/index';
import { TruncatedOutputError } from './completeOutput';

const tokens = (text: string): SourceToken[] =>
  text.split(' ').map((text, i) => ({
    id: `t${i}`,
    cueId: 'cue',
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

describe('first-pass subtitle pipeline', () => {
  it('keeps recovered alias correction indices relative to the original window', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        output([
          [0, 0, '好的'],
          [1, 2, 'GPT-4o'],
        ]),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ translations: [{ id: 1, translation: 'ChatGPT 和 Astra' }] }),
      );
    const result = await translateFirstPass(
      tokens('Okay JPT Astra'),
      { entityAliases: [{ source: 'JPT', translation: 'ChatGPT' }] },
      {},
      request,
    );
    expect(result.missingTokenIds).toEqual([]);
    expect(result.cues[1]?.corrections?.[0]).toMatchObject({
      startIndex: 1,
      endIndex: 1,
      sourceTokenIds: ['t1'],
    });
  });
  it('does not weaken evidence requirements for other model names', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(output([[0, 2, '这些版本的 Astra']]))
      .mockResolvedValueOnce(
        JSON.stringify({ translations: [{ id: 0, translation: '这些版本的 Sol' }] }),
      );
    const result = await translateFirstPass(
      tokens('versions of Sol'),
      { transcriptEvidence: ['Astra'] },
      {},
      request,
    );
    expect(result.firstPassComplete).toBe(false);
    expect(result.cues[0]?.translation).toBe('这些版本的 Sol');
    expect(result.missingTokenIds).toEqual([]);
  });
  it('does not permit Agent when neither grammatical form exists in the source', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(output([[0, 0, 'Agent']]))
      .mockResolvedValueOnce(JSON.stringify({ translations: [{ id: 0, translation: 'Astra' }] }));
    const result = await translateFirstPass(tokens('Astra'), {}, {}, request);
    expect(result.firstPassComplete).toBe(false);
    expect(result.cues[0]?.translation).toBe('Astra');
  });
  it.each([
    [[0, 0, '新的']],
    [
      [0, 1, '新的高度'],
      [1, 1, '高度'],
    ],
    [
      [1, 1, '高度'],
      [0, 0, '新的'],
    ],
    [[0, 2, '新的高度']],
  ])(
    'rejects incomplete, overlapping, reversed or out-of-range ownership: %j',
    async (...units) => {
      const request = vi
        .fn()
        .mockResolvedValueOnce(output(units as unknown as Array<[number, number, string]>))
        .mockResolvedValueOnce(output([[0, 1, '新的高度']]));
      const result = await translateFirstPass(tokens('new heights'), {}, {}, request);
      expect(result.firstPassComplete).toBe(false);
      expect(result.cues.flatMap((c) => c.sourceTokenIds)).toEqual(['t0', 't1']);
    },
  );
  it('accepts ordinary anti-AI wording and agent inflection without inventing entities', async () => {
    const request = vi.fn().mockResolvedValue(
      output([
        [0, 1, '反 AI 趋势'],
        [2, 2, 'Agent'],
      ]),
    );
    const result = await translateFirstPass(tokens('anti-AI trend agents'), {}, {}, request);
    expect(result.missingTokenIds).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('keeps grounded terminology records', async () => {
    const initial = JSON.parse(output([[0, 0, 'Astra']]));
    initial.terminology = [{ source: 'Astra', translation: 'Astra' }];
    const result = await translateFirstPass(
      tokens('Astra'),
      {},
      {},
      vi.fn().mockResolvedValue(JSON.stringify(initial)),
    );
    expect(result.cues[0]?.terminology).toEqual(initial.terminology);
  });
  it('recovers only invalid model output, not transport failures', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new TruncatedOutputError('partial'))
      .mockResolvedValueOnce(output([[0, 1, '新的高度']]));
    expect((await translateFirstPass(tokens('new heights'), {}, {}, request)).cues).toHaveLength(1);
    const disconnected = vi.fn().mockRejectedValue(new Error('network'));
    await expect(translateFirstPass(tokens('new heights'), {}, {}, disconnected)).rejects.toThrow(
      'network',
    );
    expect(disconnected).toHaveBeenCalledTimes(1);
  });
  it('accepts valid output in one request without a mandatory review', async () => {
    const request = vi.fn().mockResolvedValue(output([[0, 3, 'Sam 最近怎么样？']]));
    const result = await translateFirstPass(tokens("Sam, what's going on?"), {}, {}, request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.firstPassComplete).toBe(true);
    expect(result.missingTokenIds).toEqual([]);
    expect(result.cues[0]?.translation).toBe('Sam 最近怎么样？');
  });
  it('makes one bounded structural recovery and never guesses truncated ranges', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce('{"units":[')
      .mockResolvedValueOnce(output([[0, 1, '新的高度']]));
    const result = await translateFirstPass(tokens('new heights'), {}, {}, request);
    expect(result.firstPassComplete).toBe(false);
    expect(result.recoveryCalls).toBe(1);
    expect(result.cues).toHaveLength(1);
    expect(request.mock.calls.map((c) => c[0])).toEqual(['first-pass', 'structure-recovery']);
  });
  it('reports missing tokens if structural recovery also fails', async () => {
    const request = vi.fn().mockResolvedValue('not JSON');
    const result = await translateFirstPass(tokens('new heights'), {}, {}, request);
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.cues).toEqual([]);
    expect(result.missingTokenIds).toEqual(['t0', 't1']);
  });
  it('keeps valid cues and independently accepts valid recovery items', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        output([
          [0, 0, '好的'],
          [1, 1, 'GPT-4o'],
          [2, 2, 'GPT-4o'],
        ]),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          translations: [
            { id: 1, translation: 'Astra' },
            { id: 2, translation: 'GPT-4o' },
          ],
        }),
      );
    const result = await translateFirstPass(tokens('Okay Astra Sol'), {}, {}, request);
    expect(result.cues.map((c) => c.translation)).toEqual(['好的', 'Astra']);
    expect(result.missingTokenIds).toEqual(['t2']);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('does not replace valid cues or accept duplicate repair IDs', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        output([
          [0, 0, '好的'],
          [1, 1, 'GPT-4o'],
        ]),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          translations: [
            { id: 0, translation: '错误替换' },
            { id: 1, translation: 'Astra' },
            { id: 1, translation: 'Astra' },
          ],
        }),
      );
    const result = await translateFirstPass(tokens('Okay Astra'), {}, {}, request);
    expect(result.cues.map((c) => c.translation)).toEqual(['好的']);
    expect(result.missingTokenIds).toEqual(['t1']);
  });
  it('preserves valid cues when exception recovery cannot connect', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        output([
          [0, 0, '好的'],
          [1, 1, 'GPT-4o'],
        ]),
      )
      .mockRejectedValueOnce(new Error('network'));
    const result = await translateFirstPass(tokens('Okay Astra'), {}, {}, request);
    expect(result.cues.map((c) => c.translation)).toEqual(['好的']);
    expect(result.missingTokenIds).toEqual(['t1']);
  });
  it('does not force a second LLM request for display style alone', async () => {
    const request = vi.fn().mockResolvedValue(output([[0, 1, '“新的高度”']]));
    const result = await translateFirstPass(tokens('new heights'), {}, {}, request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.cues[0]?.translation).toBe('新的高度');
  });
  it('includes timing and first-pass semantic obligations', () => {
    const prompt = buildFirstPassPrompt(tokens('new heights'), {}, { after: 'and our alignment' });
    expect(prompt).toContain('startMs');
    expect(prompt).toContain('talking about');
    expect(prompt).toContain('不能只翻译人名');
    expect(prompt).toContain('and our alignment');
  });
});
