import { describe, expect, it } from 'vitest';
import { inspectCandidate } from './resilient-translation';
import { parseBoundaryIssues, repairDisplayBoundaries } from './boundary-repair';
const tokens = ['We', 'are', 'talking', 'about.', 'Thank', 'you.'].map((text, i) => ({
  id: `t${i}`,
  cueId: 'c',
  text,
  startMs: i * 500,
  endMs: (i + 1) * 500,
}));
const unit = (startIndex: number, endIndex: number, translation: string) => ({
  startIndex,
  endIndex,
  translation,
  sentenceEnd: true,
});
const cues = inspectCandidate(
  JSON.stringify({
    units: [unit(0, 2, '我们正在讨论'), unit(3, 3, '相关的事'), unit(4, 5, '谢谢')],
  }),
  tokens,
  {},
).units.map((u) => u.cue!);
const issue = { first: 0, last: 1, reason: '动词搭配被割裂' };
describe('local boundary repair', () => {
  it('keeps an already corrected entity and its evidence when a boundary change is requested', async () => {
    const corrected = structuredClone(cues);
    corrected[0]!.corrections = [
      {
        id: 'correction',
        startIndex: 0,
        endIndex: 0,
        sourceTokenIds: ['t0'],
        startMs: 0,
        endMs: 500,
        originalText: 'We',
        correctedText: 'ChatGPT',
        confidence: 0.99,
        category: 'proper-noun',
        applied: true,
      },
    ];
    const stages: string[] = [];
    const result = await repairDisplayBoundaries(corrected, tokens, {}, [], async (stage) => {
      stages.push(stage);
      return JSON.stringify({ issues: [issue] });
    });
    expect(result.cues).toEqual(corrected);
    expect(result.repairs[0]?.reason).toContain('转写修正');
    expect(stages).toEqual(['boundary-review']);
  });
  it('commits an unrelated valid repair even when another range fails', async () => {
    let replacements = 0;
    const result = await repairDisplayBoundaries(cues, tokens, {}, [], async (stage) => {
      if (stage === 'boundary-review')
        return JSON.stringify({ issues: [issue, { first: 2, last: 2, reason: 'test' }] });
      if (stage === 'boundary-resegment')
        return ++replacements === 1 ? '{}' : JSON.stringify({ units: [unit(0, 1, '谢谢你')] });
      if (stage === 'boundary-quality') return '{"accept":true,"reason":"有改善"}';
      return '{"issues":[]}';
    });
    expect(result.repairs.map((r) => r.status)).toEqual(['retained', 'applied']);
    expect(result.cues.slice(0, 2)).toEqual(cues.slice(0, 2));
    expect(result.cues[2]?.translation).toBe('谢谢你');
  });
  it('never fills a source coverage gap during optional polishing', async () => {
    const partial = [cues[0]!, cues[2]!];
    const result = await repairDisplayBoundaries(partial, tokens, {}, [], async () => {
      throw new Error('must not call');
    });
    expect(result.cues).toEqual(partial);
    expect(result.reviewComplete).toBe(false);
    expect(result.warnings[0]).toContain('不连续');
  });
  it('keeps a natural short answer unchanged when the reviewer finds no boundary issue', async () => {
    const result = await repairDisplayBoundaries(
      [cues[2]!],
      tokens,
      {},
      [],
      async () => '{"issues":[]}',
    );
    expect(result.cues).toEqual([cues[2]]);
    expect(result.repairs).toEqual([]);
    expect(result.reviewComplete).toBe(true);
  });
  it('merges a phrase across window edges and preserves an unrelated short response', async () => {
    const result = await repairDisplayBoundaries(cues, tokens, {}, [1500], async (stage) => {
      if (stage === 'boundary-review') return JSON.stringify({ issues: [issue] });
      if (stage === 'boundary-resegment')
        return JSON.stringify({ units: [unit(0, 3, '我们正在讨论这件事')] });
      if (stage === 'boundary-quality') return '{"accept":true,"reason":"搭配完整"}';
      return '{"issues":[]}';
    });
    expect(result.repairs[0]?.status).toBe('applied');
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0]?.endMs).toBe(2000);
    expect(result.cues[1]).toBe(cues[2]);
    expect(result.cues.flatMap((c) => c.sourceTokenIds)).toEqual(tokens.map((t) => t.id));
  });
  it.each(['{"units":[]}', JSON.stringify({ units: [unit(0, 2, '我们在讨论')] })])(
    'retains old cues after malformed or incomplete replacement',
    async (content) => {
      const result = await repairDisplayBoundaries(cues, tokens, {}, [], async (stage) =>
        stage === 'boundary-review' ? JSON.stringify({ issues: [issue] }) : content,
      );
      expect(result.cues).toEqual(cues);
      expect(result.repairs[0]?.status).toBe('retained');
    },
  );
  it('retains the whole related group if semantic verification fails', async () => {
    const result = await repairDisplayBoundaries(cues, tokens, {}, [], async (stage) => {
      if (stage === 'boundary-review') return JSON.stringify({ issues: [issue] });
      if (stage === 'boundary-resegment')
        return JSON.stringify({ units: [unit(0, 3, '我们正在讨论')] });
      return JSON.stringify({
        issues: [{ ids: ['t0..t3'], kind: 'omission', reason: '内容丢失' }],
      });
    });
    expect(result.cues).toEqual(cues);
    expect(result.repairs[0]?.reason).toContain('内容丢失');
  });
  it('does not turn a review failure into missing translations', async () => {
    const result = await repairDisplayBoundaries(cues, tokens, {}, [], async () => {
      throw new Error('offline');
    });
    expect(result.cues).toEqual(cues);
    expect(result.reviewComplete).toBe(false);
  });
  it.each(['{"accept":false,"reason":"新增了残片"}', '{"accept":"true","reason":"bad schema"}'])(
    'retains old cues when benefit verification rejects or is malformed',
    async (response) => {
      const result = await repairDisplayBoundaries(cues, tokens, {}, [], async (stage) => {
        if (stage === 'boundary-review') return JSON.stringify({ issues: [issue] });
        if (stage === 'boundary-resegment')
          return JSON.stringify({ units: [unit(0, 3, '我们正在讨论')] });
        if (stage === 'boundary-quality') return response;
        return '{"issues":[]}';
      });
      expect(result.cues).toEqual(cues);
      expect(result.repairs[0]?.status).toBe('retained');
    },
  );
  it('rejects overlapping, unknown, reversed and excessive ranges', () => {
    for (const issues of [
      [issue, issue],
      [{ first: -1, last: 1, reason: '' }],
      [{ first: 1, last: 0, reason: '' }],
      [{ first: 0, last: 6, reason: '' }],
    ])
      expect(() => parseBoundaryIssues(JSON.stringify({ issues }), cues)).toThrow();
  });
});
