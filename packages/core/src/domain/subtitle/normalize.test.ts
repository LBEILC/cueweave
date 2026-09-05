import { describe, expect, it } from 'vitest';
import { normalizeCue } from './normalize';

describe('normalizeCue', () => {
  it('decodes entities, strips markup, and normalizes spacing and punctuation', () => {
    const result = normalizeCue({
      id: 'c1',
      startMs: 0,
      endMs: 1_000,
      text: '  Rock &amp; <i>roll</i>  !!!  ',
    });

    expect(result.normalizedText).toBe('Rock & roll!');
    expect(result.sourceCueIds).toEqual(['c1']);
    expect(result.isNoise).toBe(false);
  });

  it('recognizes named speaker markers without keeping the marker in text', () => {
    const result = normalizeCue({
      id: 'c2',
      startMs: 1_000,
      endMs: 2_000,
      text: '&gt;&gt; Alice: Welcome back',
    });

    expect(result.speaker).toBe('Alice');
    expect(result.normalizedText).toBe('Welcome back');
  });

  it.each(['[Music]', '[ applause ]', '[笑声]'])('marks %s as noise', (text) => {
    expect(normalizeCue({ id: text, startMs: 0, endMs: 500, text }).isNoise).toBe(true);
  });
});
