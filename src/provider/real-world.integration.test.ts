import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../test/fixtures/youtube/VeizK1M7V7E.en.354560-385000.json';
import astraFixture from '../../test/fixtures/youtube/VeizK1M7V7E.en.785000-805000.json';
import longSemanticFixture from '../../test/fixtures/youtube/VeizK1M7V7E.long-semantic-units.json';
import { buildSourceTokens, createTokenWindows } from '../domain/subtitle';
import type { SourceToken } from '../domain/subtitle';
import { parseJson3Captions } from '../platform/youtube/captions';
import { translateTokenWindow } from './chatCompletions';

const apiKey = import.meta.env.CUEWEAVE_LLM_TOKEN;
const tokens = buildSourceTokens(parseJson3Captions(fixture));
const window = createTokenWindows(tokens).find(
  (candidate) => candidate.startMs <= 358_160 && candidate.endMs >= 360_160,
);
const astraTokens = buildSourceTokens(parseJson3Captions(astraFixture));
const astraWindow = createTokenWindows(astraTokens).find((candidate) =>
  candidate.tokens.some((token) => token.text.replace(/[^\p{L}\p{N}]/gu, '') === 'Astro'),
);

function longSemanticTokens(sample: (typeof longSemanticFixture)[number]): SourceToken[] {
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

  for (const sample of longSemanticFixture) {
    it.runIf(Boolean(apiKey))(
      `splits the real long semantic unit at ${sample.timeLabel}`,
      async () => {
        vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });
        const sampleTokens = longSemanticTokens(sample);

        const cues = await translateTokenWindow(
          {
            baseUrl: 'https://api.gpt.ge/v1',
            apiKey,
            model: 'gemini-3.1-flash-lite',
            protocol: 'chat-completions',
          },
          sampleTokens,
          undefined,
          undefined,
          { videoTitle: 'Sam Altman on OpenAI’s next model and the AI backlash' },
        );

        expect(cues.length).toBeGreaterThanOrEqual(2);
        expect(cues.flatMap((cue) => cue.sourceTokenIds)).toEqual(
          sampleTokens.map((token) => token.id),
        );
        expect(
          Math.max(...cues.map((cue) => Array.from(cue.translation.replace(/\s+/gu, '')).length)),
        ).toBeLessThanOrEqual(30);
      },
      120_000,
    );
  }

  it.runIf(Boolean(apiKey))(
    'repairs a context-supported product-name transcription error',
    async () => {
      vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });
      const correctionTokens = 'We use Chat GTT to help people write and reason every day.'
        .split(' ')
        .map((text, index) => ({
          id: `correction-${index}`,
          cueId: 'correction-cue',
          startMs: index * 240,
          endMs: (index + 1) * 240,
          text,
        }));

      const cues = await translateTokenWindow(
        {
          baseUrl: 'https://api.gpt.ge/v1',
          apiKey,
          model: 'gemini-3.1-flash-lite',
          protocol: 'chat-completions',
        },
        correctionTokens,
        undefined,
        undefined,
        { videoTitle: 'How people use ChatGPT every day' },
      );

      expect(cues.map((cue) => cue.sourceText).join(' ')).toContain('ChatGPT');
      expect(cues.flatMap((cue) => cue.corrections ?? [])).toEqual([
        expect.objectContaining({
          originalText: 'Chat GTT',
          correctedText: 'ChatGPT',
          applied: true,
        }),
      ]);
    },
    120_000,
  );

  it.runIf(Boolean(apiKey))(
    'keeps Astra grounded by the real transcript instead of inventing GPT-4o',
    async () => {
      vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });
      expect(astraWindow).toBeDefined();

      const cues = await translateTokenWindow(
        {
          baseUrl: 'https://api.gpt.ge/v1',
          apiKey,
          model: 'gemini-3.1-flash-lite',
          protocol: 'chat-completions',
        },
        astraWindow!.tokens,
        undefined,
        undefined,
        { transcriptEvidence: ['Astra'] },
      );
      const source = cues.map((cue) => cue.sourceText).join(' ');
      const translation = cues.map((cue) => cue.translation).join(' ');

      expect(source).toContain('Astra');
      expect(source).not.toContain('GPT-4o');
      expect(translation).not.toContain('GPT-4o');
      expect(translation).toContain('Soul');
      expect(cues.flatMap((cue) => cue.terminology ?? []).map((term) => term.source)).not.toContain(
        'GPT-4o',
      );
    },
    120_000,
  );

  it.runIf(Boolean(apiKey))(
    'applies a confirmed Soul to Sol mapping to the real subtitle window',
    async () => {
      vi.stubGlobal('browser', { permissions: { contains: vi.fn().mockResolvedValue(true) } });
      expect(astraWindow).toBeDefined();

      const cues = await translateTokenWindow(
        {
          baseUrl: 'https://api.gpt.ge/v1',
          apiKey,
          model: 'gemini-3.1-flash-lite',
          protocol: 'chat-completions',
        },
        astraWindow!.tokens,
        undefined,
        undefined,
        {
          transcriptEvidence: ['Astra'],
          terminology: [{ source: 'Soul', translation: 'Sol' }],
        },
      );
      const source = cues.map((cue) => cue.sourceText).join(' ');
      const translation = cues.map((cue) => cue.translation).join(' ');

      expect(source).toContain('versions of Sol');
      expect(translation).toContain('Sol');
      expect(translation).not.toMatch(/\bSoul\b/u);
    },
    120_000,
  );
});
