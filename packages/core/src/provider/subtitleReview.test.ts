import { describe, expect, it, vi } from 'vitest';
import { applySubtitleReview } from './subtitleReview';
import { translateFirstPass } from './firstPass';

const units = [
  { id: 0, source: 'A cheaper and smaller device.', translation: '一种更轻更小的设备' },
  { id: 1, source: 'We can ship it tomorrow.', translation: '我们明天可以发货' },
];
const edit = {
  id: 0,
  sourceQuote: 'cheaper',
  problem: '价格属性误译为重量属性',
  translation: '一种更便宜更小的设备',
};

describe('sparse subtitle review', () => {
  it('ignores a no-op proposal so it cannot block a separate evidence-backed correction', () => {
    expect([
      ...applySubtitleReview(
        {
          edits: [
            {
              id: 1,
              sourceQuote: 'unneeded citation',
              problem: 'no-op',
              translation: units[1]!.translation,
            },
            edit,
          ],
        },
        units,
      ),
    ]).toEqual([
      [0, edit.translation],
      [1, units[1]!.translation],
    ]);
  });
  it('changes only the cited unit and leaves unmentioned translations byte-for-byte intact', () => {
    expect([...applySubtitleReview({ edits: [edit] }, units)]).toEqual([
      [0, edit.translation],
      [1, units[1]!.translation],
    ]);
    expect([...applySubtitleReview({ edits: [] }, units)]).toEqual(
      units.map((u) => [u.id, u.translation]),
    );
  });
  it.each([
    { edits: [{ ...edit, id: 5 }] },
    { edits: [edit, edit] },
    { edits: [{ ...edit, sourceQuote: 'tomorrow' }] },
    { edits: [{ ...edit, sourceQuote: 'less expensive' }] },
    { edits: [{ ...edit, sourceQuote: ' ' }] },
    { edits: [{ ...edit, problem: '' }] },
    { edits: [{ ...edit, translation: ' ' }] },
    { edits: [{ ...edit, startMs: 100 }] },
    { translations: [{ id: 0, translation: edit.translation }] },
  ])('rejects invalid or cross-unit evidence without mutating the draft: %j', (output) => {
    const before = structuredClone(units);
    expect(() => applySubtitleReview(output, units)).toThrow();
    expect(units).toEqual(before);
  });
  it('retains every draft cue when one edit fails existing entity validation', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          units: [
            { startIndex: 0, endIndex: 0, translation: '你好', sentenceEnd: true },
            { startIndex: 1, endIndex: 1, translation: '再见', sentenceEnd: true },
          ],
          corrections: [],
          terminology: [],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          edits: [
            { id: 0, sourceQuote: 'Hello.', problem: '调整称呼', translation: '您好' },
            { id: 1, sourceQuote: 'Goodbye.', problem: '添加名称', translation: 'GPT-4o 再见' },
          ],
        }),
      );
    const source = ['Hello.', 'Goodbye.'].map((text, i) => ({
      id: `t${i}`,
      cueId: `c${i}`,
      text,
      startMs: i * 3000,
      endMs: (i + 1) * 3000,
    }));
    const result = await translateFirstPass(source, { translationMode: 'quality' }, {}, request);
    expect(result.reviewStatus).toBe('failed');
    expect(result.cues.map((c) => c.translation)).toEqual(['你好', '再见']);
    expect(result.missingTokenIds).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
