import { describe, expect, it } from 'vitest';
import fixture from '../../../../test/fixtures/youtube/VeizK1M7V7E.en.354560-385000.json';
import { parseJson3Captions } from '../../src/platform/youtube/captions';
import {
  AiSubtitleBoundaryError,
  applyAiSubtitleBoundaryRepair,
  buildAiSubtitleBoundaryRepairPrompt,
  parseAiSubtitleOutput,
} from '@cueweave/core/subtitle/ai';
import { buildSourceTokens, createTokenWindows } from '@cueweave/core/subtitle/tokens';

const tokens = buildSourceTokens(parseJson3Captions(fixture));

describe('real YouTube caption windows', () => {
  it('contains the words after hey in the same model window', () => {
    const windows = createTokenWindows(tokens);
    const window = windows.find(
      (candidate) => candidate.startMs <= 358_160 && candidate.endMs >= 360_160,
    );
    const heyIndex = window?.tokens.findIndex((token) => token.text === 'hey,') ?? -1;
    const followingIndex = window?.tokens.findIndex((token) => token.text === "we're") ?? -1;

    expect(window?.startMs).toBe(354_560);
    expect(heyIndex).toBeGreaterThanOrEqual(0);
    expect(followingIndex).toBe(heyIndex + 1);
    expect(window?.tokens.slice(heyIndex, heyIndex + 8).map((token) => token.text)).toEqual([
      'hey,',
      "we're",
      'going',
      'to',
      'put',
      'safety',
      'in',
      'front',
    ]);
  });

  it('lets a boundary repair move hey into the following statement', () => {
    const heyIndex = tokens.findIndex((token) => token.text === 'hey,');
    const responseIndex = tokens.findIndex((token) => token.text === 'response');
    const likeIndex = tokens.findIndex((token) => token.text === 'like,');
    const statementEndIndex = tokens.findIndex(
      (token, index) => index > heyIndex && token.text === 'have.',
    );
    const originalContent = JSON.stringify({
      units: [
        {
          startIndex: 0,
          endIndex: heyIndex,
          translation: '我认为更清醒理性的回应应该是，像是在说嘿',
          sentenceEnd: false,
        },
        {
          startIndex: heyIndex + 1,
          endIndex: statementEndIndex,
          translation: '我们会把安全置于一切之前并持续提高优先级',
          sentenceEnd: true,
        },
        {
          startIndex: statementEndIndex + 1,
          endIndex: tokens.length - 1,
          translation: '节目广告内容',
          sentenceEnd: true,
        },
      ],
    });

    let boundaryError: AiSubtitleBoundaryError | undefined;
    try {
      parseAiSubtitleOutput(originalContent, tokens);
    } catch (error) {
      if (error instanceof AiSubtitleBoundaryError) boundaryError = error;
    }

    expect(boundaryError?.issues[0]).toMatchObject({
      replaceStartUnitIndex: 0,
      replaceEndUnitIndex: 1,
      startIndex: 0,
      endIndex: statementEndIndex,
    });
    expect(buildAiSubtitleBoundaryRepairPrompt(tokens, boundaryError!)).toContain(
      `"index":${heyIndex + 1},"text":"we're"`,
    );

    const result = applyAiSubtitleBoundaryRepair(
      originalContent,
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: responseIndex,
            translation: '我认为更清醒理性的回应应该是',
            sentenceEnd: false,
          },
          {
            startIndex: responseIndex + 1,
            endIndex: likeIndex,
            translation: '意思就像是在说',
            sentenceEnd: false,
          },
          {
            startIndex: heyIndex,
            endIndex: statementEndIndex,
            translation: '嘿我们会把安全置于一切之前并持续提高优先级',
            sentenceEnd: true,
          },
        ],
      }),
      tokens,
      boundaryError!,
    );

    expect(result[2]?.sourceText).toMatch(/^hey, we're going to put safety/u);
    expect(result[2]?.translation).toMatch(/^嘿我们会把安全/u);
    expect(result.at(-1)?.translation).toBe('节目广告内容');
  });
});
