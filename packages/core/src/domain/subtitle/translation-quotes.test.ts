import { describe, expect, it } from 'vitest';
import {
  AiSubtitleBoundaryError,
  buildAiSubtitleBoundaryRepairPrompt,
  buildAiSubtitlePrompt,
  parseAiSubtitleFallbackOutput,
  parseAiSubtitleOutput,
  TRANSLATION_QUOTE_RULE,
} from './ai';
import type { SourceToken } from './types';

function tokensFor(source: string): SourceToken[] {
  return source.split(' ').map((text, index) => ({
    id: `quote-${index}`,
    cueId: 'quote-cue',
    text,
    startMs: index * 500,
    endMs: (index + 1) * 500,
  }));
}
function outputFor(tokens: readonly SourceToken[], translation: string) {
  return JSON.stringify({
    units: [{ startIndex: 0, endIndex: tokens.length - 1, translation, sentenceEnd: true }],
  });
}

describe.each([
  ['normal parsing', parseAiSubtitleOutput],
  ['fallback parsing', parseAiSubtitleFallbackOutput],
] as const)('translation quotation marks during %s', (_name, parse) => {
  it.each([
    '“阅读你能找到的所有论文”',
    '"阅读你能找到的所有论文"',
    '‘阅读你能找到的所有论文’',
    "'阅读你能找到的所有论文'",
    '「阅读你能找到的所有论文」',
    '『阅读你能找到的所有论文』',
    '“阅读你能找到的所有论文',
    '阅读你能找到的所有论文”',
    '“ 阅读你能找到的所有论文 ”',
  ])('removes quote styling without changing source coverage: %s', (translation) => {
    const source = 'read every paper you can possibly find.';
    const tokens = tokensFor(source);
    const cues = parse(outputFor(tokens, translation), tokens);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({
      translation: '阅读你能找到的所有论文',
      sourceText: source,
      originalText: source,
      startMs: 0,
      endMs: tokens.at(-1)!.endMs,
      sourceTokenIds: tokens.map((t) => t.id),
    });
  });
  it('preserves Latin apostrophes, titles, content periods and meaningful punctuation', () => {
    const tokens = tokensFor("O'Reilly O’Reilly l’école Node.js GPT-5.6 5.6 supports audio.");
    const translation = "“O'Reilly、O’Reilly、l’école《教程》Node.js GPT-5.6 能支持5.6吗？当然！”";
    expect(parse(outputFor(tokens, translation), tokens)[0]?.translation).toBe(
      "O'Reilly、O’Reilly、l’école《教程》Node.js GPT-5.6 能支持5.6吗？当然！",
    );
  });
  it('does not change quotation marks in original English', () => {
    const source = 'He said "read every paper".';
    const tokens = tokensFor(source);
    expect(parse(outputFor(tokens, '他说“阅读所有论文”'), tokens)[0]).toMatchObject({
      sourceText: source,
      originalText: source,
      translation: '他说阅读所有论文',
    });
  });
  it('rejects a quote-only translation instead of displaying an empty caption', () => {
    const tokens = tokensFor('Read it.');
    expect(() => parse(outputFor(tokens, '“”'), tokens)).toThrow('清理显示标点后为空');
  });
});

it('states the same quote rule in generation and boundary repair prompts', () => {
  const tokens = tokensFor('Read every paper and find every result.');
  let boundaryError: AiSubtitleBoundaryError | undefined;
  try {
    parseAiSubtitleOutput(outputFor(tokens, '阅读所有论文，找到全部结果'), tokens);
  } catch (error) {
    if (error instanceof AiSubtitleBoundaryError) boundaryError = error;
    else throw error;
  }
  expect(boundaryError).toBeDefined();
  expect(buildAiSubtitlePrompt(tokens)).toContain(TRANSLATION_QUOTE_RULE);
  expect(buildAiSubtitleBoundaryRepairPrompt(tokens, boundaryError!)).toContain(
    TRANSLATION_QUOTE_RULE,
  );
});
