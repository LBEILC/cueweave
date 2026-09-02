import { describe, expect, it } from 'vitest';
import type { SourceToken } from './types';
import {
  buildEntityAliasPrompt,
  buildEntityAliasAttachmentPrompt,
  extractTranscriptEntityCandidates,
  inferAnchoredAcronymAliases,
  parseEntityAliasAttachmentOutput,
  parseEntityAliasOutput,
} from './entities';

function tokensFor(source: string): SourceToken[] {
  return source.split(/\s+/u).map((text, index) => ({
    id: `token-${index}`,
    cueId: `cue-${Math.floor(index / 8)}`,
    startMs: index * 250,
    endMs: (index + 1) * 250,
    text,
  }));
}

const realTranscriptExcerpt = tokensFor(
  [
    'I used this CHBT work session that went for 34 hours.',
    'Before chat GBT maybe people thought of AI as this very narrow thing.',
    'There are a lot of people who think AI is still just JPT.',
    'I think that CHBT is using up all the water in the world.',
    'CHBT just hit a billion users.',
    'I had stopped using chat GBT and asked Codex all my chat questions.',
  ].join(' '),
);

describe('video entity alias resolution', () => {
  it('extracts repeated ASR entity variants with bounded contexts', () => {
    const candidates = extractTranscriptEntityCandidates(realTranscriptExcerpt);

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ observed: 'CHBT', count: 3 }),
        expect.objectContaining({ observed: 'JPT', count: 1 }),
        expect.objectContaining({ observed: 'chat GBT', count: 2 }),
      ]),
    );
    expect(candidates.every((candidate) => candidate.contexts.length <= 3)).toBe(true);
  });

  it('accepts a high-confidence cluster when a near spelling anchors repeated variants', () => {
    const candidates = extractTranscriptEntityCandidates(realTranscriptExcerpt);
    const aliases = parseEntityAliasOutput(
      JSON.stringify({
        clusters: [
          {
            canonical: 'ChatGPT',
            aliases: ['chat GBT', 'CHBT', 'JPT'],
            confidence: 0.97,
          },
        ],
      }),
      candidates,
    );

    expect(aliases).toEqual([
      { source: 'chat GBT', translation: 'ChatGPT' },
      { source: 'CHBT', translation: 'ChatGPT' },
      { source: 'JPT', translation: 'ChatGPT' },
    ]);
  });

  it('rejects a familiar model replacement with no close alias anchor', () => {
    const candidates = [
      { observed: 'Astra', count: 3, contexts: ['versions of Astra'] },
      { observed: 'Soul', count: 2, contexts: ['versions of Soul'] },
    ];
    const aliases = parseEntityAliasOutput(
      JSON.stringify({
        clusters: [
          {
            canonical: 'GPT-4o',
            aliases: ['Astra', 'Soul'],
            confidence: 0.99,
          },
        ],
      }),
      candidates,
      { videoTitle: 'A conversation about GPT-4o' },
    );

    expect(aliases).toEqual([]);
  });

  it('attaches short uppercase variants only to an already anchored canonical entity', () => {
    const attached = parseEntityAliasAttachmentOutput(
      JSON.stringify({
        matches: [
          { observed: 'CHBT', canonical: 'ChatGPT', confidence: 0.96 },
          { observed: 'JPT', canonical: 'ChatGPT', confidence: 0.93 },
          { observed: 'Soul', canonical: 'ChatGPT', confidence: 0.99 },
          { observed: 'CHBT', canonical: 'GPT-4o', confidence: 0.99 },
        ],
      }),
      [
        { observed: 'CHBT', count: 3, contexts: ['CHBT just hit a billion users'] },
        { observed: 'JPT', count: 1, contexts: ['AI is still just JPT'] },
        { observed: 'Soul', count: 2, contexts: ['versions of Soul'] },
      ],
      [{ source: 'chat GBT', translation: 'ChatGPT' }],
    );

    expect(attached).toEqual([
      { source: 'CHBT', translation: 'ChatGPT' },
      { source: 'JPT', translation: 'ChatGPT' },
    ]);
  });

  it('infers a one-letter ASR variant of an anchored trailing acronym', () => {
    expect(
      inferAnchoredAcronymAliases(
        [
          { observed: 'chat GBT', count: 2, contexts: ['before chat GBT'] },
          { observed: 'CHBT', count: 3, contexts: ['CHBT reached a billion users'] },
          { observed: 'JPT', count: 1, contexts: ['AI is still just JPT'] },
          { observed: 'Soul', count: 2, contexts: ['versions of Soul'] },
        ],
        [
          { source: 'chat GBT', translation: 'ChatGPT' },
          { source: 'CHBT', translation: 'ChatGPT' },
        ],
      ),
    ).toEqual([{ source: 'JPT', translation: 'ChatGPT' }]);
  });

  it('tells the model that topic similarity is not enough evidence', () => {
    const prompt = buildEntityAliasPrompt(extractTranscriptEntityCandidates(realTranscriptExcerpt));

    expect(prompt).toContain('视频主题相同本身不是充分证据');
    expect(prompt).toContain('至少一个 alias 与 canonical');
    expect(prompt).toContain('"observed":"CHBT"');
    expect(
      buildEntityAliasAttachmentPrompt(
        [{ observed: 'JPT', count: 1, contexts: ['AI is still just JPT'] }],
        [{ source: 'chat GBT', translation: 'ChatGPT' }],
      ),
    ).toContain('canonical 必须逐字选自');
  });
});
