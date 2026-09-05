import { expect, it } from 'vitest';
import { localPlaybackSeam } from './localSeam';
import type { SourceToken } from '../domain/subtitle/types';

const input = (): SourceToken[] =>
  Array.from({ length: 60 }, (_, i) => ({
    id: `t${i}`,
    cueId: 'c',
    text: 'word',
    startMs: i * 1000,
    endMs: (i + 1) * 1000,
  }));
it('moves a cutoff inside a phrase back to a nearby sentence ending', () => {
  const tokens = input();
  tokens[26]!.text = 'too!';
  tokens[27]!.text = 'I';
  tokens[28]!.text = 'was';
  tokens[29]!.text = 'gonna';
  tokens[30]!.text = 'say';
  tokens[31]!.text = 'that,';
  expect(localPlaybackSeam(tokens, 30)).toBe(27);
});
it('does not move an uncertain unpunctuated seam or violate the two-window duration limits', () => {
  const tokens = input();
  expect(localPlaybackSeam(tokens, 30)).toBe(30);
  tokens[10]!.text = 'end.';
  expect(localPlaybackSeam(tokens, 15)).toBe(15);
});
it('does not select a pause after an unfinished modal or negation', () => {
  const tokens = input();
  tokens[28]!.text = 'might';
  tokens[28]!.endMs -= 500;
  expect(localPlaybackSeam(tokens, 30)).toBe(30);
});
