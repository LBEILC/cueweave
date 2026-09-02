import { describe, expect, it } from 'vitest';
import {
  AiSubtitleBoundaryError,
  applyAiSubtitleBoundaryRepair,
  buildAiSubtitleBoundaryRepairPrompt,
  buildAiSubtitlePrompt,
  findAiSubtitleReviewIssue,
  parseAiSubtitleFallbackOutput,
  parseAiSubtitleOutput,
} from './ai';
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

  it('rejects extra fields while keeping a long semantic unit intact', () => {
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
    expect(result).toHaveLength(1);
    expect(result[0]?.translation).toBe(unit.translation);
    expect(result[0]?.sourceTokenIds).toEqual(tokens.map((token) => token.id));
    expect(result[0]?.sentenceEnd).toBe(true);
  });

  it('rejects readable clause punctuation unless the model returns exact token ranges', () => {
    const tokens = tokensFor(
      'The better the model understands business intent the better it performs.',
    );
    expect(() =>
      parseAiSubtitleOutput(
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
      ),
    ).toThrow('请改用多个连续词元范围');

    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: 6,
            translation: '模型越能理解企业的业务意图',
            sentenceEnd: false,
          },
          {
            startIndex: 7,
            endIndex: 10,
            translation: '表现就越好',
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
    expect(result.map((cue) => cue.sourceText)).toEqual([
      'The better the model understands business intent',
      'the better it performs.',
    ]);
  });

  it('preserves one Chinese whitespace as a spoken pause', () => {
    const tokens = tokensFor(
      'We reviewed many samples and found unexpected behavior even though it looked fine alone.',
    );
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: tokens.length - 1,
            translation: '我们阅读了大量样本后发现 这种行为不符合预期',
            sentenceEnd: true,
          },
        ],
      }),
      tokens,
    );

    expect(result[0]?.translation).toBe('我们阅读了大量样本后发现 这种行为不符合预期');
  });

  it('can clean display separators without inventing new token boundaries', () => {
    const tokens = tokensFor('A precise model selected range.');
    const result = parseAiSubtitleFallbackOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: 4,
            translation: '模型已选择范围， 这里只清理显示符号。',
            sentenceEnd: true,
          },
        ],
      }),
      tokens,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.translation).toBe('模型已选择范围这里只清理显示符号');
    expect(result[0]?.sourceTokenIds).toEqual(tokens.map((token) => token.id));
  });

  it('repairs a rejected boundary together with its adjacent units', () => {
    const tokens = tokensFor(
      'First thought. And I think a clear eyed sober response is better. Final thought.',
    );
    const originalContent = JSON.stringify({
      units: [
        { startIndex: 0, endIndex: 1, translation: '第一个观点', sentenceEnd: true },
        {
          startIndex: 2,
          endIndex: 11,
          translation: '我认为保持清醒，作出稳健回应会更好',
          sentenceEnd: true,
        },
        { startIndex: 12, endIndex: 13, translation: '最后一个观点', sentenceEnd: true },
      ],
    });

    let boundaryError: AiSubtitleBoundaryError | undefined;
    try {
      parseAiSubtitleOutput(originalContent, tokens);
    } catch (error) {
      if (error instanceof AiSubtitleBoundaryError) boundaryError = error;
    }
    expect(boundaryError?.issues).toHaveLength(1);

    const prompt = buildAiSubtitleBoundaryRepairPrompt(tokens, boundaryError!);
    expect(prompt).toContain('只修复下面列出的中文字幕 unit');
    expect(prompt).toContain('targetTokens');
    expect(prompt).toContain('contextBefore');

    const result = applyAiSubtitleBoundaryRepair(
      originalContent,
      JSON.stringify({
        units: [
          { startIndex: 0, endIndex: 1, translation: '第一个观点', sentenceEnd: true },
          { startIndex: 2, endIndex: 7, translation: '我认为应该保持清醒', sentenceEnd: false },
          { startIndex: 8, endIndex: 11, translation: '作出稳健回应会更好', sentenceEnd: true },
          { startIndex: 12, endIndex: 13, translation: '最后一个观点', sentenceEnd: true },
        ],
      }),
      tokens,
      boundaryError!,
    );

    expect(result.map((cue) => cue.translation)).toEqual([
      '第一个观点',
      '我认为应该保持清醒',
      '作出稳健回应会更好',
      '最后一个观点',
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

  it('marks an unusually long initial unit for semantic review without splitting it', () => {
    const tokens = tokensFor(
      'This complete expression remains meaningful only when all of its details are considered together.',
    );
    const translation =
      '这段表达只有在所有细节都被完整结合起来考虑时才能保持原本准确且不可分割的含义';
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: tokens.length - 1,
            translation,
            sentenceEnd: true,
          },
        ],
      }),
      tokens,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.translation).toBe(translation);
    expect(findAiSubtitleReviewIssue(result)).toContain('语义复审');
  });

  it('never splits an English term or proportionally remaps its source tokens', () => {
    const source =
      'and I also think that it is in our business interest to make sure that we have safe reliable robust AI like customers want this.';
    const tokens = tokensFor(source);
    const translation = '我也认为确保我们拥有安全可靠且稳健的AI符合我们的商业利益因为客户想要这样';
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: tokens.length - 1,
            translation,
            sentenceEnd: true,
          },
        ],
      }),
      tokens,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.translation).toBe(translation);
    expect(result[0]?.translation).toContain('AI');
    expect(result[0]?.sourceText).toBe(source);
    expect(result[0]?.sourceTokenIds).toEqual(tokens.map((token) => token.id));
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

  it('applies a high-confidence ASR correction while preserving the original text', () => {
    const tokens = tokensFor('We use Chat GTT every day.');
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: 5,
            translation: '我们每天都使用ChatGPT',
            sentenceEnd: true,
          },
        ],
        corrections: [
          {
            startIndex: 2,
            endIndex: 3,
            correctedText: 'ChatGPT',
            confidence: 0.98,
            category: 'proper-noun',
          },
        ],
        terminology: [{ source: 'ChatGPT', translation: 'ChatGPT' }],
      }),
      tokens,
      true,
      { videoTitle: 'How teams use ChatGPT' },
    );

    expect(result[0]?.originalText).toBe('We use Chat GTT every day.');
    expect(result[0]?.sourceText).toBe('We use ChatGPT every day.');
    expect(result[0]?.corrections).toEqual([
      expect.objectContaining({
        originalText: 'Chat GTT',
        correctedText: 'ChatGPT',
        applied: true,
      }),
    ]);
    expect(result[0]?.terminology).toEqual([{ source: 'ChatGPT', translation: 'ChatGPT' }]);
  });

  it('atomically applies a verified video entity alias even when the window omits corrections', () => {
    const tokens = tokensFor('I think that CHBT is using up all the water.');
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: tokens.length - 1,
            translation: '我认为ChatGPT正在耗尽全世界的水资源',
            sentenceEnd: true,
          },
        ],
        corrections: [],
        terminology: [],
      }),
      tokens,
      true,
      { entityAliases: [{ source: 'CHBT', translation: 'ChatGPT' }] },
    );

    expect(result[0]?.originalText).toBe('I think that CHBT is using up all the water.');
    expect(result[0]?.sourceText).toBe('I think that ChatGPT is using up all the water.');
    expect(result[0]?.corrections).toEqual([
      expect.objectContaining({
        originalText: 'CHBT',
        correctedText: 'ChatGPT',
        confidence: 1,
        applied: true,
      }),
    ]);
  });

  it('matches a spaced verified alias against the compact ASR form', () => {
    const tokens = tokensFor('I stopped using chatgbt for those questions.');
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: tokens.length - 1,
            translation: '我不再使用ChatGPT回答这些问题',
            sentenceEnd: true,
          },
        ],
        corrections: [],
        terminology: [],
      }),
      tokens,
      true,
      { entityAliases: [{ source: 'chat GBT', translation: 'ChatGPT' }] },
    );

    expect(result[0]?.sourceText).toBe('I stopped using ChatGPT for those questions.');
  });

  it('records but does not apply a low-confidence correction', () => {
    const tokens = tokensFor('The speaker said Nova.');
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [{ startIndex: 0, endIndex: 3, translation: '说话者提到了Nova', sentenceEnd: true }],
        corrections: [
          {
            startIndex: 3,
            endIndex: 3,
            correctedText: 'Nora',
            confidence: 0.62,
            category: 'proper-noun',
          },
        ],
        terminology: [],
      }),
      tokens,
    );

    expect(result[0]?.sourceText).toBe('The speaker said Nova.');
    expect(result[0]?.corrections?.[0]?.applied).toBe(false);
  });

  it('ignores model corrections when transcript repair is disabled', () => {
    const tokens = tokensFor('We use Chat GTT every day.');
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: 5,
            translation: '我们每天都使用ChatGPT',
            sentenceEnd: true,
          },
        ],
        corrections: [
          {
            startIndex: 2,
            endIndex: 3,
            correctedText: 'ChatGPT',
            confidence: 0.99,
            category: 'proper-noun',
          },
        ],
        terminology: [],
      }),
      tokens,
      false,
      { videoTitle: 'How teams use ChatGPT' },
    );

    expect(result[0]?.originalText).toBe('We use Chat GTT every day.');
    expect(result[0]?.sourceText).toBe('We use Chat GTT every day.');
    expect(result[0]?.corrections).toEqual([]);
  });

  it('rejects a familiar model name invented for an Astra transcription variant', () => {
    const tokens = tokensFor(
      'This does not impact Astra. Well Astro will be a model family with versions of Astra.',
    );
    const astroIndex = tokens.findIndex((token) => token.text === 'Astro');

    expect(() =>
      parseAiSubtitleOutput(
        JSON.stringify({
          units: [
            {
              startIndex: 0,
              endIndex: tokens.length - 1,
              translation: '这不会影响Astra GPT-4o将成为一个模型家族',
              sentenceEnd: true,
            },
          ],
          corrections: [
            {
              startIndex: astroIndex,
              endIndex: astroIndex,
              correctedText: 'GPT-4o',
              confidence: 0.99,
              category: 'proper-noun',
            },
          ],
          terminology: [{ source: 'GPT-4o', translation: 'GPT-4o' }],
        }),
        tokens,
      ),
    ).toThrow('GPT-4o');
  });

  it('uses repeated transcript evidence to repair a new proper noun without metadata', () => {
    const tokens = tokensFor(
      'This does not impact Astra. Well Astro will be a model family with versions of Astra.',
    );
    const astroIndex = tokens.findIndex((token) => token.text === 'Astro');
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: tokens.length - 1,
            translation: '这不会影响Astra 它将成为拥有多个版本的模型家族',
            sentenceEnd: true,
          },
        ],
        corrections: [
          {
            startIndex: astroIndex,
            endIndex: astroIndex,
            correctedText: 'Astra',
            confidence: 0.96,
            category: 'proper-noun',
          },
        ],
        terminology: [{ source: 'Astra', translation: 'Astra' }],
      }),
      tokens,
    );

    expect(result[0]?.sourceText).toContain('Well Astra will');
    expect(result[0]?.corrections?.[0]).toMatchObject({
      originalText: 'Astro',
      correctedText: 'Astra',
      applied: true,
    });
    expect(result[0]?.terminology).toEqual([{ source: 'Astra', translation: 'Astra' }]);
  });

  it('preserves a one-off unknown name when no supporting evidence exists', () => {
    const tokens = tokensFor('The new model is Astro.');
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: tokens.length - 1,
            translation: '新模型名为Astro',
            sentenceEnd: true,
          },
        ],
        corrections: [
          {
            startIndex: 4,
            endIndex: 4,
            correctedText: 'Astra',
            confidence: 0.99,
            category: 'proper-noun',
          },
        ],
        terminology: [{ source: 'Astra', translation: 'Astra' }],
      }),
      tokens,
    );

    expect(result[0]?.sourceText).toBe('The new model is Astro.');
    expect(result[0]?.corrections?.[0]?.applied).toBe(false);
    expect(result[0]?.terminology).toBeUndefined();
  });

  it('uses repeated full-video terms when the current window has only the ASR variant', () => {
    const tokens = tokensFor('Well Astro will be a model family.');
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: tokens.length - 1,
            translation: 'Astra将成为一个模型家族',
            sentenceEnd: true,
          },
        ],
        corrections: [
          {
            startIndex: 1,
            endIndex: 1,
            correctedText: 'Astra',
            confidence: 0.96,
            category: 'proper-noun',
          },
        ],
        terminology: [{ source: 'Astra', translation: 'Astra' }],
      }),
      tokens,
      true,
      { transcriptEvidence: ['Astra'] },
    );

    expect(result[0]?.sourceText).toBe('Well Astra will be a model family.');
    expect(result[0]?.corrections?.[0]?.applied).toBe(true);
  });

  it('does not remember an unsupported Latin name as a term translation', () => {
    const tokens = tokensFor('Astra is a model family.');
    const result = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: tokens.length - 1,
            translation: 'Astra是一个模型家族',
            sentenceEnd: true,
          },
        ],
        corrections: [],
        terminology: [{ source: 'Astra', translation: 'GPT-4o' }],
      }),
      tokens,
    );

    expect(result[0]?.terminology).toBeUndefined();
  });

  it('rejects overlapping correction ranges', () => {
    const tokens = tokensFor('Chat GTT is useful.');
    expect(() =>
      parseAiSubtitleOutput(
        JSON.stringify({
          units: [{ startIndex: 0, endIndex: 3, translation: 'ChatGPT很有用', sentenceEnd: true }],
          corrections: [
            {
              startIndex: 0,
              endIndex: 1,
              correctedText: 'ChatGPT',
              confidence: 0.99,
              category: 'proper-noun',
            },
            {
              startIndex: 1,
              endIndex: 1,
              correctedText: 'GPT',
              confidence: 0.99,
              category: 'formatting',
            },
          ],
          terminology: [],
        }),
        tokens,
      ),
    ).toThrow('重叠、乱序或越界');
  });

  it('rejects a spoken discourse marker stranded at the previous cue boundary', () => {
    const tokens = tokensFor("A clear response is like hey, we're ready now.");
    expect(() =>
      parseAiSubtitleOutput(
        JSON.stringify({
          units: [
            {
              startIndex: 0,
              endIndex: 5,
              translation: '明确的回应就像是说嘿',
              sentenceEnd: false,
            },
            {
              startIndex: 6,
              endIndex: 8,
              translation: '我们已经准备好了',
              sentenceEnd: true,
            },
          ],
          corrections: [],
          terminology: [],
        }),
        tokens,
      ),
    ).toThrow('口语引导词');
  });

  it('includes display constraints and indexed tokens in the prompt', () => {
    const prompt = buildAiSubtitlePrompt(tokensFor('Hello world.'), {
      videoTitle: 'A ChatGPT interview',
      videoDescription: 'A discussion of the Astra model family.',
      transcriptEvidence: ['Astra'],
      terminology: [{ source: 'ChatGPT', translation: 'ChatGPT' }],
    });
    expect(prompt).toContain('不得出现在 translation 中');
    expect(prompt).toContain('不能仅为了满足字符数硬切');
    expect(prompt).toContain('可以用单个空格表现明显的口语停顿');
    expect(prompt).toContain('不要求每个 unit 自己构成完整句');
    expect(prompt).toContain('不得拆开 AI 等英文词');
    expect(prompt).toContain('A ChatGPT interview');
    expect(prompt).toContain('A discussion of the Astra model family.');
    expect(prompt).toContain('"transcriptEvidence":["Astra"]');
    expect(prompt).toContain('禁止替换成 GPT-4o');
    expect(prompt).toContain('既有术语');
    expect(prompt).not.toContain('36');
    expect(prompt).toContain('{"index":0,"text":"Hello"}');
    expect(prompt).toContain('{"index":1,"text":"world."}');
  });
});
