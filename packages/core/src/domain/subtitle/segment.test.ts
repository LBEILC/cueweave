import { describe, expect, it } from 'vitest';
import { normalizeCues } from './normalize';
import { segmentCues } from './segment';

describe('segmentCues', () => {
  it('ends a segment on strong punctuation and maps local timestamps', () => {
    const segments = segmentCues(
      normalizeCues([
        { id: 'c1', startMs: 100, endMs: 600, text: 'This is' },
        { id: 'c2', startMs: 600, endMs: 1_200, text: 'a sentence.' },
        { id: 'c3', startMs: 1_200, endMs: 1_800, text: 'Next one' },
      ]),
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      sourceCueIds: ['c1', 'c2'],
      startMs: 100,
      endMs: 1_200,
      sourceText: 'This is a sentence.',
    });
    expect(segments[1]?.sourceText).toBe('Next one');
  });

  it('breaks on pauses and speaker changes', () => {
    const segments = segmentCues(
      normalizeCues([
        { id: 'c1', startMs: 0, endMs: 500, text: 'First thought' },
        { id: 'c2', startMs: 2_000, endMs: 2_500, text: 'after a pause' },
        { id: 'c3', startMs: 2_500, endMs: 3_000, text: '>> Bob: New speaker' },
      ]),
    );

    expect(segments.map((segment) => segment.sourceText)).toEqual([
      'First thought',
      'after a pause',
      'New speaker',
    ]);
  });

  it('breaks before character and duration limits are exceeded', () => {
    const segments = segmentCues(
      normalizeCues([
        { id: 'c1', startMs: 0, endMs: 500, text: '12345' },
        { id: 'c2', startMs: 500, endMs: 1_000, text: '67890' },
      ]),
      { maxCharacters: 8, maxDurationMs: 800 },
    );

    expect(segments).toHaveLength(2);
  });

  it('skips noise cues by default', () => {
    const segments = segmentCues(
      normalizeCues([
        { id: 'c1', startMs: 0, endMs: 500, text: '[Music]' },
        { id: 'c2', startMs: 500, endMs: 1_000, text: 'Welcome.' },
      ]),
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]?.sourceCueIds).toEqual(['c2']);
  });
});
