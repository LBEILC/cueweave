import { describe, expect, it } from 'vitest';
import { processSubtitleCues } from './pipeline';

describe('processSubtitleCues', () => {
  it('turns rolling YouTube cues into stable semantic segments', () => {
    const segments = processSubtitleCues([
      { id: 'c1', startMs: 0, endMs: 600, text: 'and I think' },
      { id: 'c2', startMs: 500, endMs: 1_100, text: 'and I think the most important thing is' },
      {
        id: 'c3',
        startMs: 1_000,
        endMs: 2_000,
        text: 'and I think the most important thing is how people respond to it.',
      },
      { id: 'c4', startMs: 2_100, endMs: 2_600, text: '[Music]' },
    ]);

    expect(segments).toEqual([
      {
        id: 'segment:c1:c3',
        sourceCueIds: ['c1', 'c2', 'c3'],
        startMs: 0,
        endMs: 2_000,
        sourceText: 'and I think the most important thing is how people respond to it.',
        translation: '',
        status: 'pending',
      },
    ]);
  });
});
