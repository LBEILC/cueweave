import { describe, expect, it } from 'vitest';
import fixture from '../../../test/fixtures/youtube/VeizK1M7V7E.en.785000-805000.json';
import { parseJson3Captions } from '../../platform/youtube/captions';
import { parseAiSubtitleOutput } from './ai';
import { extractTranscriptEvidenceTerms, extractUnitTechnicalEntities } from './evidence';
import { buildSourceTokens } from './tokens';

const tokens = buildSourceTokens(parseJson3Captions(fixture));
const normalizedToken = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '');
const astroIndex = tokens.findIndex((token) => normalizedToken(token.text) === 'Astro');
const soulIndex = tokens.findIndex((token) => normalizedToken(token.text) === 'Soul');

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
  it('locks a locally mentioned model name without treating a lowercase URL as a model', () => {
    expect(
      extractUnitTechnicalEntities(
        'Astra will become a family of models and there will be versions of Soul.',
      ),
    ).toContain('Soul');
    expect(extractUnitTechnicalEntities('Try it at granola.ai/sources today.')).toEqual([]);
  });

  it('contains repeated Astra evidence around the one Astro ASR error', () => {
    expect(astroIndex).toBeGreaterThanOrEqual(0);
    expect(soulIndex).toBeGreaterThanOrEqual(0);
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
      outputWithCorrection('Astra', '这不会影响Astra 它将成为拥有多个版本的Soul模型家族'),
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

  it('does not let Astra replace Soul inside the current unit', () => {
    expect(() =>
      parseAiSubtitleOutput(
        JSON.stringify({
          units: [
            {
              startIndex: 0,
              endIndex: tokens.length - 1,
              translation: 'Astra将成为一个模型家族 并拥有多个版本的Astra',
              sentenceEnd: true,
            },
          ],
          corrections: [],
          terminology: [],
        }),
        tokens,
        true,
        { transcriptEvidence: ['Astra'] },
      ),
    ).toThrow('Soul');
  });

  it('does not mistake a longer Latin word for the current entity', () => {
    expect(() =>
      parseAiSubtitleOutput(
        JSON.stringify({
          units: [
            {
              startIndex: 0,
              endIndex: tokens.length - 1,
              translation: 'Astra将成为一个模型家族 还会提供Solution版本',
              sentenceEnd: true,
            },
          ],
          corrections: [],
          terminology: [],
        }),
        tokens,
        true,
        { transcriptEvidence: ['Astra', 'Solution'] },
      ),
    ).toThrow('Soul');
  });

  it('accepts the confirmed Soul to Sol mapping and source repair', () => {
    const cues = parseAiSubtitleOutput(
      JSON.stringify({
        units: [
          {
            startIndex: 0,
            endIndex: tokens.length - 1,
            translation: 'Astra将成为一个模型家族 并拥有多个版本的Sol',
            sentenceEnd: true,
          },
        ],
        corrections: [
          {
            startIndex: soulIndex,
            endIndex: soulIndex,
            correctedText: 'Sol',
            confidence: 0.99,
            category: 'proper-noun',
          },
        ],
        terminology: [],
      }),
      tokens,
      true,
      {
        transcriptEvidence: ['Astra'],
        terminology: [{ source: 'Soul', translation: 'Sol' }],
      },
    );

    expect(cues[0]?.sourceText).toContain('versions of Sol');
    expect(cues[0]?.corrections).toEqual([
      expect.objectContaining({ originalText: 'Soul.', correctedText: 'Sol', applied: true }),
    ]);
  });
});
