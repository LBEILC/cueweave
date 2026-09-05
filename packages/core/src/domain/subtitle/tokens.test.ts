import { describe, expect, it } from 'vitest';
import { buildSourceTokens, createLocalDisplayCues, createTokenWindows } from './tokens';
import type { RawCue } from './types';

function timedCue(id: string, startMs: number, endMs: number, words: readonly string[]): RawCue {
  const durationMs = endMs - startMs;
  return {
    id,
    startMs,
    endMs,
    text: words.join(' '),
    words: words.map((text, index) => ({
      id: `${id}:word:${index}`,
      startMs: startMs + Math.floor((durationMs * index) / words.length),
      endMs: startMs + Math.floor((durationMs * (index + 1)) / words.length),
      text,
    })),
  };
}

describe('word-timed display pipeline', () => {
  it('preserves YouTube word timing in source tokens', () => {
    const tokens = buildSourceTokens([timedCue('c1', 1_000, 2_000, ['Hello', 'world.'])]);

    expect(tokens).toEqual([
      {
        id: 'c1:word:0',
        cueId: 'c1',
        startMs: 1_000,
        endMs: 1_500,
        text: 'Hello',
      },
      {
        id: 'c1:word:1',
        cueId: 'c1',
        startMs: 1_500,
        endMs: 2_000,
        text: 'world.',
      },
    ]);
  });

  it('splits sentences at punctuation inside a YouTube cue', () => {
    const tokens = buildSourceTokens([
      timedCue('c1', 0, 2_000, ['How', 'we', 'work', 'at', 'all.', "We're", 'wired']),
    ]);

    expect(createLocalDisplayCues(tokens).map((cue) => cue.sourceText)).toEqual([
      'How we work at all.',
      "We're wired",
    ]);
  });

  it('does not cut a long fallback subtitle at an arbitrary article', () => {
    const tokens = buildSourceTokens([
      timedCue(
        'c1',
        0,
        8_000,
        'We care about other people, and want to work with other people.'.split(' '),
      ),
    ]);
    const cues = createLocalDisplayCues(tokens, { maxCharacters: 38, maxDurationMs: 8_000 });

    expect(cues.map((cue) => cue.sourceText)).toEqual([
      'We care about other people,',
      'and want to work with other people.',
    ]);
  });

  it('builds bounded model windows at sentence endings', () => {
    const tokens = buildSourceTokens([
      timedCue('c1', 0, 2_000, ['One', 'short', 'sentence.']),
      timedCue('c2', 2_000, 4_000, ['Another', 'complete', 'sentence.']),
    ]);
    const windows = createTokenWindows(tokens, { targetTokens: 3, maxTokens: 5 });

    expect(windows.map((window) => window.tokens.map((token) => token.text))).toEqual([
      ['One', 'short', 'sentence.'],
      ['Another', 'complete', 'sentence.'],
    ]);
  });

  it('handles the reported ASR passage without ending on an incomplete article', () => {
    const words =
      "how we work at all. We're we're so wired to care about other people, want to work with other people. We have such a great intuition as the world evolves for what people want. Um I think that's a fundamentally human thing no matter how smart AI gets.".split(
        ' ',
      );
    const cues = createLocalDisplayCues(
      buildSourceTokens([timedCue('reported', 2_135_359, 2_150_400, words)]),
    );

    expect(cues[0]?.sourceText).toBe('how we work at all.');
    expect(cues.every((cue) => !/\b(?:a|an|the)$/iu.test(cue.sourceText))).toBe(true);
    expect(cues.every((cue) => cue.sourceText.length <= 84)).toBe(true);
    expect(cues.every((cue) => cue.endMs - cue.startMs <= 6_500)).toBe(true);
  });
});
