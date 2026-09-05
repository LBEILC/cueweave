import { describe, expect, it } from 'vitest';
import { continuousWindowGroups, repairAcrossSeams } from './continuous-boundaries';
import { inspectCandidate } from './resilient-translation';
const tokens = ['AI', 'reached', 'new', 'heights', 'and', 'continued.'].map((text, i) => ({
  id: `t${i}`,
  cueId: 'c',
  text,
  startMs: i * 500,
  endMs: (i + 1) * 500,
}));
const window = (start: number, end: number) => ({
  id: `w${start}`,
  startMs: tokens[start]!.startMs,
  endMs: tokens[end]!.endMs,
  tokens: tokens.slice(start, end + 1),
});
const unit = (startIndex: number, endIndex: number, translation: string) => ({
  startIndex,
  endIndex,
  translation,
  sentenceEnd: true,
});
const cues = inspectCandidate(
  JSON.stringify({
    units: [unit(0, 2, 'AI 达到了新的'), unit(3, 3, '新高度'), unit(4, 5, '并继续前进')],
  }),
  tokens,
  {},
).units.map((u) => u.cue!);
describe('continuous source ownership', () => {
  it('relocates later seams by stable token IDs after an earlier merge', async () => {
    let audits = 0;
    const result = await repairAcrossSeams(
      cues,
      tokens,
      {},
      ['t4', 't3', 't3'],
      async (stage, prompt) => {
        if (stage.endsWith('boundary-review')) {
          audits++;
          const data = JSON.parse(prompt.split('\n').at(-1)!);
          if (audits === 2) {
            expect(data.units.map((u: { source: string }) => u.source)).toEqual([
              'AI reached new heights',
              'and continued.',
            ]);
            return '{"issues":[]}';
          }
          return '{"issues":[{"first":0,"last":1,"reason":"tight phrase"}]}';
        }
        if (stage.endsWith('boundary-resegment'))
          return JSON.stringify({ units: [unit(0, 3, 'AI 达到了新的高度')] });
        if (stage.endsWith('boundary-quality')) return '{"accept":true,"reason":"complete phrase"}';
        return '{"issues":[]}';
      },
    );
    expect(audits).toBe(2);
    expect(result.details.map((d) => d.rightTokenId)).toEqual(['t3', 't4']);
    expect(result.cues.flatMap((c) => c.sourceTokenIds)).toEqual(tokens.map((t) => t.id));
  });
  it('does not repair across a missing token at a seam', async () => {
    const partial = [cues[0]!, cues[2]!];
    const result = await repairAcrossSeams(partial, tokens, {}, ['t4'], async () => {
      throw new Error('must not call');
    });
    expect(result.cues).toEqual(partial);
    expect(result.details[0]?.status).toBe('unavailable');
  });
  it('joins adjacent selections irrespective of their experiment labels', () => {
    expect(continuousWindowGroups(tokens, [window(3, 5), window(0, 2)])).toEqual([
      [window(0, 2), window(3, 5)],
    ]);
  });
  it('never bridges an unselected source gap', () => {
    expect(continuousWindowGroups(tokens, [window(0, 1), window(4, 5)])).toHaveLength(2);
  });
  it('rejects overlaps and foreign or reordered tokens', () => {
    expect(() => continuousWindowGroups(tokens, [window(0, 3), window(3, 5)])).toThrow();
    expect(() =>
      continuousWindowGroups(tokens, [
        { ...window(0, 2), tokens: [...tokens.slice(0, 3)].reverse() },
      ]),
    ).toThrow();
  });
  it('allows a local repair to own both sides and preserves all source IDs', async () => {
    const result = await repairAcrossSeams(cues, tokens, {}, ['t3'], async (stage) => {
      if (stage.endsWith('boundary-review'))
        return '{"issues":[{"first":0,"last":1,"reason":"new heights 被拆开"}]}';
      if (stage.endsWith('boundary-resegment'))
        return JSON.stringify({ units: [unit(0, 3, 'AI 达到了新的高度')] });
      if (stage.endsWith('boundary-quality')) return '{"accept":true,"reason":"完整搭配"}';
      return '{"issues":[]}';
    });
    expect(result.cues[0]?.sourceTokenIds).toEqual(['t0', 't1', 't2', 't3']);
    expect(result.cues[1]).toBe(cues[2]);
    expect(result.cues.flatMap((c) => c.sourceTokenIds)).toEqual(tokens.map((t) => t.id));
  });
  it('keeps output after an unavailable model and skips already joined or unavailable seams', async () => {
    const result = await repairAcrossSeams(cues, tokens, {}, ['t1', 't3', 'unknown'], async () => {
      throw new Error('offline');
    });
    expect(result.cues).toEqual(cues);
    expect(result.details.map((d) => d.status).sort()).toEqual([
      'already-joined',
      'reviewed',
      'unavailable',
    ]);
    expect(result.details.find((d) => d.status === 'reviewed')?.result?.reviewComplete).toBe(false);
  });
});
