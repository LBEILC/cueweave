import { describe, expect, it } from 'vitest';
import {
  AiSubtitleBoundaryError,
  buildAiSubtitleBoundaryRepairPrompt,
  buildAiSubtitlePrompt,
  parseAiSubtitleFallbackOutput,
  parseAiSubtitleOutput,
} from './ai';
import type { SourceToken } from './types';

function tokensFor(source: string): SourceToken[] {
  return source.split(' ').map((text, index) => ({
    id: `period-${index}`,
    cueId: 'period-cue',
    startMs: index * 250,
    endMs: (index + 1) * 250,
    text,
  }));
}

function outputFor(tokens: readonly SourceToken[], translation: string): string {
  return JSON.stringify({
    units: [{ startIndex: 0, endIndex: tokens.length - 1, translation, sentenceEnd: true }],
    corrections: [],
    terminology: [],
  });
}

describe.each([
  ['normal parsing', parseAiSubtitleOutput],
  ['fallback parsing', parseAiSubtitleFallbackOutput],
] as const)('content periods during %s', (_name, parse) => {
  it.each([
    ['Version 5.6 is ready.', '5.6版本已准备好。', '5.6版本已准备好'],
    [
      'We are upgrading to 5.6 now.',
      '我们准备升级到5.6版本并开始测试',
      '我们准备升级到5.6版本并开始测试',
    ],
    ['We use GPT-5.6.', '我们使用GPT-5.6.', '我们使用GPT-5.6'],
    ['Release v1.2.3 is ready.', 'v1.2.3已发布。', 'v1.2.3已发布'],
    ['It increased by 5.6 percent.', '它增长了5.6%。', '它增长了5.6%'],
    ['It dropped to -0.25.', '它下降至-0.25。', '它下降至-0.25'],
    ['We use Node.js.', '我们使用Node.js.', '我们使用Node.js'],
    ['We use 5.6.', '嗯...5.6。', '嗯5.6'],
  ])('preserves content dots in %s', (source, translation, expected) => {
    const tokens = tokensFor(source);
    const cues = parse(outputFor(tokens, translation), tokens);

    expect(cues).toHaveLength(1);
    expect(cues[0]?.translation).toBe(expected);
    expect(cues[0]?.sourceText).toBe(source);
  });
});

describe('sentence punctuation alongside content periods', () => {
  it.each(['。', '.', '，', '；', '：'])(
    'still reviews a clause boundary written as %s',
    (mark) => {
      const tokens = tokensFor('Version 5.6 is ready and the team can test it.');
      const content = outputFor(tokens, `5.6版本已准备好${mark}团队现在可以测试`);

      expect(() => parseAiSubtitleOutput(content, tokens)).toThrow(AiSubtitleBoundaryError);
      expect(parseAiSubtitleFallbackOutput(content, tokens)[0]?.translation).toBe(
        '5.6版本已准备好团队现在可以测试',
      );
    },
  );

  it('states the content-dot exception in both generation and boundary repair prompts', () => {
    const tokens = tokensFor('Version 5.6 is ready and the team can test it.');
    let boundaryError: AiSubtitleBoundaryError | undefined;
    try {
      parseAiSubtitleOutput(outputFor(tokens, '5.6版本已准备好，团队现在可以测试'), tokens);
    } catch (error) {
      if (error instanceof AiSubtitleBoundaryError) boundaryError = error;
      else throw error;
    }
    expect(boundaryError).toBeDefined();
    for (const prompt of [
      buildAiSubtitlePrompt(tokens),
      buildAiSubtitleBoundaryRepairPrompt(tokens, boundaryError!),
    ]) {
      expect(prompt).toContain('版本号、小数和标识符内部的英文点号');
      expect(prompt).toContain('5.6');
      expect(prompt).toContain('不得删除或作为分句边界');
    }
  });
});
