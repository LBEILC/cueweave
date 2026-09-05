import { describe, expect, it } from 'vitest';
import fixture from '../../../../../test/fixtures/youtube/VeizK1M7V7E.long-semantic-units.json';
import {
  AiSubtitleBoundaryError,
  applyAiSubtitleBoundaryRepair,
  parseAiSubtitleFallbackOutput,
  parseAiSubtitleOutput,
} from './ai';
import type { SourceToken } from './types';

type LongSemanticSample = (typeof fixture)[number];

function tokensForSample(sample: LongSemanticSample): SourceToken[] {
  const words = sample.sourceText.split(/\s+/u);
  const duration = sample.endMs - sample.startMs;
  return words.map((text, index) => ({
    id: `${sample.timeLabel}:${index}`,
    cueId: sample.timeLabel,
    startMs: sample.startMs + Math.round((duration * index) / words.length),
    endMs: sample.startMs + Math.round((duration * (index + 1)) / words.length),
    text,
  }));
}

function initialOutput(sample: LongSemanticSample, tokens: readonly SourceToken[]): string {
  return JSON.stringify({
    units: [
      {
        startIndex: 0,
        endIndex: tokens.length - 1,
        translation: sample.translation,
        sentenceEnd: true,
      },
    ],
    corrections: [],
    terminology: [],
  });
}

function preferredBoundaryIndex(
  sample: LongSemanticSample,
  tokens: readonly SourceToken[],
): number {
  const words = sample.preferredBoundary.toLocaleLowerCase().split(/\s+/u);
  for (let index = tokens.length - words.length; index >= 1; index -= 1) {
    if (words.every((word, offset) => tokens[index + offset]?.text.toLocaleLowerCase() === word)) {
      return index;
    }
  }
  return -1;
}

describe('long semantic units from the real YouTube transcript', () => {
  it.each(fixture)('flags the long $timeLabel unit for exact semantic repair', (sample) => {
    const tokens = tokensForSample(sample);
    let boundaryError: AiSubtitleBoundaryError | undefined;

    try {
      parseAiSubtitleOutput(initialOutput(sample, tokens), tokens);
    } catch (error) {
      if (error instanceof AiSubtitleBoundaryError) boundaryError = error;
    }

    expect(boundaryError?.issues).toEqual([
      expect.objectContaining({
        replaceStartUnitIndex: 0,
        replaceEndUnitIndex: 0,
        startIndex: 0,
        endIndex: tokens.length - 1,
      }),
    ]);
    expect(boundaryError?.issues[0]?.reason).toContain('不要按连接词或字符数机械切割');
  });

  it.each(fixture)('accepts a model-selected boundary near $preferredBoundary', (sample) => {
    const tokens = tokensForSample(sample);
    const boundaryIndex = preferredBoundaryIndex(sample, tokens);
    expect(boundaryIndex).toBeGreaterThan(0);

    let boundaryError: AiSubtitleBoundaryError | undefined;
    try {
      parseAiSubtitleOutput(initialOutput(sample, tokens), tokens);
    } catch (error) {
      if (error instanceof AiSubtitleBoundaryError) boundaryError = error;
    }
    expect(boundaryError).toBeDefined();

    const cues = applyAiSubtitleBoundaryRepair(
      initialOutput(sample, tokens),
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: boundaryIndex - 1,
            translation: '前一个可以独立阅读的意群',
            sentenceEnd: false,
          },
          {
            startIndex: boundaryIndex,
            endIndex: tokens.length - 1,
            translation: '后一个可以独立阅读的意群',
            sentenceEnd: true,
          },
        ],
        corrections: [],
        terminology: [],
      }),
      tokens,
      boundaryError!,
    );

    expect(cues).toHaveLength(2);
    expect(cues.flatMap((cue) => cue.sourceTokenIds)).toEqual(tokens.map((token) => token.id));
    expect(cues[0]?.sentenceEnd).toBe(false);
    expect(cues[1]?.sentenceEnd).toBe(true);
  });

  it('does not force a long indivisible unit to split only because of its length', () => {
    const sample: LongSemanticSample = {
      timeLabel: 'control',
      startMs: 0,
      endMs: 8_000,
      sourceText:
        'A remarkably detailed explanation remains meaningful only through its complete uninterrupted technical formulation across specialized domains worldwide today',
      translation: '这是一段很长但没有明显并列连接点的完整技术表达因此不能只按照字符数量机械切分',
      preferredBoundary: '',
    };
    const tokens = tokensForSample(sample);

    expect(parseAiSubtitleOutput(initialOutput(sample, tokens), tokens)).toHaveLength(1);
  });

  it('repairs only the flagged long unit instead of pulling in valid neighbors', () => {
    const sample = fixture[0]!;
    const middleTokens = tokensForSample(sample);
    const prefix: SourceToken[] = [
      { id: 'prefix:0', cueId: 'prefix', startMs: 0, endMs: 200, text: 'Earlier' },
      { id: 'prefix:1', cueId: 'prefix', startMs: 200, endMs: 400, text: 'context.' },
    ];
    const suffix: SourceToken[] = [
      { id: 'suffix:0', cueId: 'suffix', startMs: 1_400_000, endMs: 1_400_200, text: 'Later' },
      { id: 'suffix:1', cueId: 'suffix', startMs: 1_400_200, endMs: 1_400_400, text: 'context.' },
    ];
    const tokens = [...prefix, ...middleTokens, ...suffix];
    const content = JSON.stringify({
      units: [
        { startIndex: 0, endIndex: 1, translation: '前文', sentenceEnd: true },
        {
          startIndex: prefix.length,
          endIndex: prefix.length + middleTokens.length - 1,
          translation: sample.translation,
          sentenceEnd: true,
        },
        {
          startIndex: prefix.length + middleTokens.length,
          endIndex: tokens.length - 1,
          translation: '后文',
          sentenceEnd: true,
        },
      ],
      corrections: [],
      terminology: [],
    });

    let boundaryError: AiSubtitleBoundaryError | undefined;
    try {
      parseAiSubtitleOutput(content, tokens);
    } catch (error) {
      if (error instanceof AiSubtitleBoundaryError) boundaryError = error;
    }

    expect(boundaryError?.issues[0]).toMatchObject({
      replaceStartUnitIndex: 1,
      replaceEndUnitIndex: 1,
      startIndex: prefix.length,
      endIndex: prefix.length + middleTokens.length - 1,
    });
  });

  it('keeps a verified long translation as the final fallback if repair cannot split it', () => {
    const sample = fixture[0]!;
    const tokens = tokensForSample(sample);

    const cues = parseAiSubtitleFallbackOutput(initialOutput(sample, tokens), tokens);

    expect(cues).toHaveLength(1);
    expect(cues[0]?.translation).toBe(sample.translation);
  });
});
