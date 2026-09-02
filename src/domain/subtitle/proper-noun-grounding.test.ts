import { describe, expect, it } from 'vitest';
import fixture from '../../../test/fixtures/youtube/VeizK1M7V7E.en.785000-805000.json';
import { parseJson3Captions } from '../../platform/youtube/captions';
import { parseAiSubtitleOutput } from './ai';
import { extractTranscriptEvidenceTerms } from './evidence';
import { buildSourceTokens } from './tokens';

const tokens = buildSourceTokens(parseJson3Captions(fixture));
const normalizedToken = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '');
const astroIndex = tokens.findIndex((token) => normalizedToken(token.text) === 'Astro');

function outputWithCorrection(correctedText: string, translation: string): string {
  return JSON.stringify({
    units: [
      {
        startIndex: 0,
        endIndex: tokens.length - 1,
        translation,
        sentenceEnd: true,
      },
    ],
    corrections: [
      {
        startIndex: astroIndex,
        endIndex: astroIndex,
        correctedText,
        confidence: 0.98,
        category: 'proper-noun',
      },
    ],
    terminology: [{ source: correctedText, translation: correctedText }],
  });
}

describe('proper-noun grounding on the Astra subtitle fixture', () => {
  it('contains repeated Astra evidence around the one Astro ASR error', () => {
    expect(astroIndex).toBeGreaterThanOrEqual(0);
    expect(tokens.filter((token) => normalizedToken(token.text) === 'Astra')).toHaveLength(2);
  });

  it('extracts Astra as repeated video evidence without common sentence starters', () => {
    const evidence = extractTranscriptEvidenceTerms(tokens);

    expect(evidence).toContain('Astra');
    expect(evidence).not.toContain('This');
    expect(evidence).not.toContain('Well');
  });

  it('rejects GPT-4o invented by the model for the Astro token', () => {
    expect(() =>
      parseAiSubtitleOutput(
        outputWithCorrection('GPT-4o', '这不会影响Astra GPT-4o将成为拥有多个版本的模型家族'),
        tokens,
      ),
    ).toThrow('GPT-4o');
  });

  it('accepts Astro to Astra because the same video window supports it', () => {
    const cues = parseAiSubtitleOutput(
      outputWithCorrection('Astra', '这不会影响Astra 它将成为拥有多个版本的模型家族'),
      tokens,
    );

    expect(cues[0]?.sourceText).toContain('Astra will be a model in the family');
    expect(cues[0]?.corrections).toEqual([
      expect.objectContaining({
        originalText: 'Astro',
        correctedText: 'Astra',
        applied: true,
      }),
    ]);
  });
});
