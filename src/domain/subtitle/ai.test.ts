import { describe, expect, it } from 'vitest';
import { buildAiSubtitlePrompt, parseAiSubtitleOutput } from './ai';
import type { SourceToken } from './types';

function tokensFor(text: string): SourceToken[] {
  return text.split(' ').map((token, index) => ({
    id: `word:${index}`,
    cueId: 'cue:1',
    startMs: index * 200,
    endMs: (index + 1) * 200,
    text: token,
  }));
}

describe('AI subtitle output', () => {
  it('maps complete token ranges back to program-owned timing', () => {
    const tokens = tokensFor('How we work at all. We care about other people.');
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: 4,
            translation: '我们就是这样工作的',
            sentenceEnd: true,
          },
          {
            startIndex: 5,
            endIndex: 9,
            translation: '我们关心他人',
            sentenceEnd: true,
          },
        ],
      }),
      tokens,
    );

    expect(result.map((cue) => [cue.startMs, cue.endMs, cue.sourceText, cue.translation])).toEqual([
      [0, 1_000, 'How we work at all.', '我们就是这样工作的'],
      [1_000, 2_000, 'We care about other people.', '我们关心他人'],
    ]);
  });

  it('rejects missing token ranges', () => {
    const tokens = tokensFor('One two three four');
    expect(() =>
      parseAiSubtitleOutput(
        JSON.stringify({
          units: [
            {
              startIndex: 0,
              endIndex: 1,
              translation: '一二',
              sentenceEnd: false,
            },
            {
              startIndex: 3,
              endIndex: 3,
              translation: '四',
              sentenceEnd: true,
            },
          ],
        }),
        tokens,
      ),
    ).toThrow('遗漏、重复或乱序');
  });

  it('rejects extra fields and only splits translations longer than 36 characters', () => {
    const tokens = tokensFor('One two three four five six seven eight nine ten eleven twelve.');
    const unit = {
      startIndex: 0,
      endIndex: 11,
      translation:
        '这是一条为了测试极端情况而故意写得非常非常长并且明显超过两行字幕合理容量的中文翻译结果',
      sentenceEnd: true,
    };

    expect(() =>
      parseAiSubtitleOutput(
        JSON.stringify({ units: [{ ...unit, sourceText: 'Hello world.' }] }),
        tokens,
      ),
    ).toThrow('不符合结构要求');

    const result = parseAiSubtitleOutput(JSON.stringify({ units: [unit] }), tokens);
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((cue) => Array.from(cue.translation).length <= 36)).toBe(true);
    expect(result.flatMap((cue) => cue.sourceTokenIds)).toEqual(tokens.map((token) => token.id));
    expect(result.at(-1)?.sentenceEnd).toBe(true);
    expect(result.slice(0, -1).every((cue) => !cue.sentenceEnd)).toBe(true);
  });

  it('splits a readable clause boundary near 20 characters', () => {
    const tokens = tokensFor(
      'The better the model understands business intent the better it performs.',
    );
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: 10,
            translation: '模型越能理解企业的业务意图，表现就越好。',
            sentenceEnd: true,
          },
        ],
      }),
      tokens,
    );

    expect(result.map((cue) => cue.translation)).toEqual([
      '模型越能理解企业的业务意图',
      '表现就越好',
    ]);
    expect(result.flatMap((cue) => cue.sourceTokenIds)).toEqual(tokens.map((token) => token.id));
  });

  it('keeps a longer translation intact when it has no natural boundary', () => {
    const tokens = tokensFor('A complete phrase should stay together for readability.');
    const translation = '这段完整而连续的表达为了可读性应该保持在一起';
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: 7,
            translation,
            sentenceEnd: true,
          },
        ],
      }),
      tokens,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.translation).toBe(translation);
  });

  it('removes hidden punctuation while preserving a Chinese enumeration comma', () => {
    const tokens = tokensFor('The model supports text images and audio.');
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: 6,
            translation: '模型支持文本、图像和音频。',
            sentenceEnd: true,
          },
        ],
      }),
      tokens,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.translation).toBe('模型支持文本、图像和音频');
  });

  it('includes display constraints and indexed tokens in the prompt', () => {
    const prompt = buildAiSubtitlePrompt(tokensFor('Hello world.'));
    expect(prompt).toContain('不得出现在 translation 中');
    expect(prompt).toContain('{"index":0,"text":"Hello"}');
    expect(prompt).toContain('{"index":1,"text":"world."}');
  });
});
