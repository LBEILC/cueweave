import { describe, expect, it } from 'vitest';
import { planRollingSeams } from './rolling-seams';
import type { Episode } from './window-experiment';
const tokens = Array.from({ length: 120 }, (_, i) => ({
  id: `t${i}`,
  cueId: 'c',
  text: `w${i}`,
  startMs: i * 1000,
  endMs: (i + 1) * 1000,
}));
const episode: Episode = {
  id: 'private',
  context: {},
  tokens,
  windows: [0, 30, 60, 90].map((i) => ({
    id: `w${i}`,
    startMs: i * 1000,
    endMs: (i + 30) * 1000,
    tokens: tokens.slice(i, i + 30),
  })),
  review: {
    id: 'private',
    label: 'PRIVATE_ANSWER',
    review: 'PRIVATE_ANSWER',
    startMs: 0,
    endMs: 120000,
  },
};
describe('rolling seams', () => {
  it('revisits old group edges, commits each token once, and keeps answers out of prompts', async () => {
    const starts: number[] = [];
    const result = await planRollingSeams(episode, tokens, async (_stage, prompt) => {
      expect(prompt).not.toContain('PRIVATE_ANSWER');
      const data = JSON.parse(prompt.split('\n').find((line) => line.startsWith('{"neighbors"'))!);
      starts.push(data.tokens[0].startMs);
      return JSON.stringify({
        windows: [
          { endIndex: 30, reason: '完整搭配' },
          { endIndex: data.tokens.length - 1, reason: '尾部' },
        ],
      });
    });
    expect(starts).toEqual([0, 31000, 62000]);
    expect(result.windows.map((w) => w.endMs)).toEqual([31000, 62000, 93000, 120000]);
    expect(result.windows.flatMap((w) => w.tokens)).toEqual(tokens);
    expect(result.steps.every((s) => !s.fallback)).toBe(true);
  });
  it('retains coverage on invalid plans and exposes each fallback', async () => {
    const result = await planRollingSeams(episode, tokens, async () => '{"windows":[]}');
    expect(result.windows).toEqual(episode.windows);
    expect(result.steps.filter((s) => s.fallback)).toHaveLength(3);
  });
  it('does not call a model for a singleton tail', async () => {
    const one = { ...episode, windows: episode.windows.slice(0, 1), tokens: tokens.slice(0, 30) };
    const result = await planRollingSeams(one, tokens, async () => {
      throw new Error('unexpected');
    });
    expect(result.steps).toEqual([]);
    expect(result.windows).toEqual(one.windows);
  });
});
