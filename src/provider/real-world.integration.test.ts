import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../test/fixtures/youtube/VeizK1M7V7E.en.354560-385000.json';
import { buildSourceTokens, createTokenWindows } from '../domain/subtitle';
import { parseJson3Captions } from '../platform/youtube/captions';
import { translateTokenWindow } from './chatCompletions';

const apiKey = import.meta.env.CUEWEAVE_LLM_TOKEN;
const tokens = buildSourceTokens(parseJson3Captions(fixture));
const window = createTokenWindows(tokens).find(
  (candidate) => candidate.startMs <= 358_160 && candidate.endMs >= 360_160,
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('real subtitle model integration', () => {
  it.runIf(Boolean(apiKey))(
    'keeps hey with the statement that follows it',
    async () => {
      vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });
      expect(window).toBeDefined();
      const heyToken = window!.tokens.find((token) => token.text === 'hey,');
      expect(heyToken).toBeDefined();

      const cues = await translateTokenWindow(
        {
          baseUrl: 'https://api.gpt.ge/v1',
          apiKey,
          model: 'gemini-3.1-flash-lite',
          protocol: 'chat-completions',
        },
        window!.tokens,
      );
      const heyCue = cues.find((cue) => cue.sourceTokenIds.includes(heyToken!.id));

      expect(heyCue?.sourceText).toMatch(/hey, we're/u);
    },
    120_000,
  );
});
