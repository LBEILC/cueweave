import { describe, expect, it } from 'vitest';
import type { SourceToken } from '@cueweave/core/subtitle';
import { parseSeam, seamPrompt } from './seam-planner';
import type { Episode } from './window-experiment';

const tokens: SourceToken[] = Array.from({ length: 40 }, (_, i) => ({
  id: `t${i}`,
  cueId: 'c',
  text: `word${i}`,
  startMs: i * 1000,
  endMs: (i + 1) * 1000,
}));
const episode: Episode = {
  id: 'test',
  tokens,
  context: {},
  windows: [
    { id: 'a', startMs: 0, endMs: 20000, tokens: tokens.slice(0, 20) },
    { id: 'b', startMs: 20000, endMs: 40000, tokens: tokens.slice(20) },
  ],
  review: {
    id: 'test',
    label: 'PRIVATE_LABEL',
    startMs: 0,
    endMs: 40000,
    review: 'PRIVATE_ANSWER',
  },
};
const response = (ends: number[]) =>
  JSON.stringify({ windows: ends.map((endIndex) => ({ endIndex, reason: 'boundary' })) });
describe('bounded seam planning', () => {
  it('moves a seam while retaining source ownership', () => {
    const plan = parseSeam(response([24, 39]), episode);
    expect(plan.windows.map((w) => w.tokens.length)).toEqual([25, 15]);
    expect(plan.windows.flatMap((w) => w.tokens)).toEqual(tokens);
  });
  it('rejects extra short windows and unsupported partitions', () => {
    expect(() => parseSeam(response([12, 25, 39]), episode)).toThrow();
    expect(() => parseSeam(response([9, 39]), episode)).toThrow();
    expect(() => parseSeam(response([39]), episode)).toThrow();
  });
  it('does not expose review labels or reference answers', () => {
    const prompt = seamPrompt(episode, { before: '', after: '' });
    expect(prompt).toContain('originalEndIndex');
    expect(prompt).not.toContain('PRIVATE_');
  });
});
