import { describe, expect, it } from 'vitest';
import { fullEpisodes, runWorkers } from './full-seams';
import type { EvalRun } from './types';

describe('full E planning', () => {
  const tokens = Array.from({ length: 5 }, (_, i) => ({
    id: `t${i}`,
    text: 'hello',
    cueId: 'c',
    startMs: i * 1000,
    endMs: (i + 1) * 1000,
  }));
  const baseline = {
    tokens,
    windows: tokens.map((t) => ({ id: t.id, tokens: [t], startMs: t.startMs, endMs: t.endMs })),
    identity: { context: {}, mode: 'pipeline' },
    aliases: [{ source: 'CHBT', translation: 'ChatGPT' }],
    results: {},
  } as unknown as EvalRun;
  it('covers an odd window count including the final singleton without old translations', () => {
    const episodes = fullEpisodes(baseline);
    expect(episodes.map((e) => e.windows.length)).toEqual([2, 2, 1]);
    expect(episodes.flatMap((e) => e.tokens)).toEqual(tokens);
    expect(episodes.every((e) => e.context.previousCues?.length === 0)).toBe(true);
    expect(episodes[0]?.context.entityAliases).toEqual(baseline.aliases);
  });
  it('rejects a baseline that omits part of the full transcript', () => {
    expect(() => fullEpisodes({ ...baseline, windows: baseline.windows.slice(1) })).toThrow('覆盖');
  });
  it('schedules each block once with bounded concurrency', async () => {
    const seen: number[] = [];
    let active = 0,
      peak = 0;
    await runWorkers([0, 1, 2, 3, 4], 2, async (i) => {
      active++;
      peak = Math.max(peak, active);
      seen.push(i);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    });
    expect(seen.sort()).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });
});
