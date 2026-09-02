import { describe, expect, it } from 'vitest';
import { parseJson3Captions } from './captions';

describe('parseJson3Captions', () => {
  it('maps JSON3 events to stable raw cues', () => {
    const cues = parseJson3Captions({
      events: [
        { tStartMs: 100, dDurationMs: 400, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
        { tStartMs: 500, segs: [{ utf8: 'Again' }] },
      ],
    });

    expect(cues).toEqual([
      { id: 'yt:0:100', startMs: 100, endMs: 500, text: 'Hello world' },
      { id: 'yt:1:500', startMs: 500, endMs: 2_500, text: 'Again' },
    ]);
  });

  it('ignores metadata events without caption text', () => {
    expect(parseJson3Captions({ events: [{ tStartMs: 0 }] })).toEqual([]);
  });
});
