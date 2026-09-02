import { describe, expect, it } from 'vitest';
import { deduplicateRollingCues } from './dedupe';
import { normalizeCues } from './normalize';

describe('deduplicateRollingCues', () => {
  it('keeps only newly revealed text from rolling prefix captions', () => {
    const result = deduplicateRollingCues(
      normalizeCues([
        { id: 'c1', startMs: 0, endMs: 700, text: 'I think' },
        { id: 'c2', startMs: 600, endMs: 1_300, text: 'I think this is' },
        { id: 'c3', startMs: 1_200, endMs: 2_000, text: 'I think this is important.' },
      ]),
    );

    expect(result.map((cue) => cue.normalizedText)).toEqual(['I think', 'this is', 'important.']);
  });

  it('removes suffix-prefix overlap', () => {
    const result = deduplicateRollingCues(
      normalizeCues([
        { id: 'c1', startMs: 0, endMs: 900, text: 'I think this is' },
        { id: 'c2', startMs: 800, endMs: 1_700, text: 'this is important' },
      ]),
    );

    expect(result.map((cue) => cue.normalizedText)).toEqual(['I think this is', 'important']);
  });

  it('merges exact duplicate cue identity into the prior cue', () => {
    const result = deduplicateRollingCues(
      normalizeCues([
        { id: 'c1', startMs: 0, endMs: 900, text: 'Hello' },
        { id: 'c2', startMs: 800, endMs: 1_600, text: 'Hello' },
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.sourceCueIds).toEqual(['c1', 'c2']);
    expect(result[0]?.endMs).toBe(1_600);
  });

  it('does not deduplicate the same words after a long pause', () => {
    const result = deduplicateRollingCues(
      normalizeCues([
        { id: 'c1', startMs: 0, endMs: 500, text: 'Again' },
        { id: 'c2', startMs: 5_000, endMs: 5_500, text: 'Again' },
      ]),
    );

    expect(result).toHaveLength(2);
  });
});
