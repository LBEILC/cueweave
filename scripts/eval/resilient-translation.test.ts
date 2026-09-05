import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SourceToken } from '@cueweave/core/subtitle';
import {
  applyFixedTranslations,
  inspectCandidate,
  parseReview,
  parseRecoveryPlan,
  recoverCandidate,
  fixedPrompt,
  reviewSchema,
} from './resilient-translation';
import { TRANSLATION_QUOTE_RULE } from '@cueweave/core/subtitle/ai';
import { successfulCues, type EvalRun } from './types';
import { summarize } from './analysis';

const tokens: SourceToken[] = ['Sam,', "what's", 'going', 'on?', 'Hello', 'world.'].map(
  (text, i) => ({ id: `t${i}`, cueId: 'c', text, startMs: i * 500, endMs: (i + 1) * 500 }),
);
const initial = JSON.stringify({
  units: [
    { startIndex: 0, endIndex: 3, translation: '萨姆', sentenceEnd: true },
    { startIndex: 4, endIndex: 5, translation: '你好世界', sentenceEnd: true },
  ],
  corrections: [],
  terminology: [],
});
const review = JSON.stringify({
  issues: [{ ids: ['t0..t3'], kind: 'omission', reason: '问候含义遗漏' }],
});

describe('resilient translation experiment', () => {
  it('repairs all IDs in a cross-caption issue without changing their ranges', async () => {
    const result = await recoverCandidate(
      initial,
      tokens,
      {},
      {},
      async (stage, prompt, schema) => {
        if (stage === 'semantic-review') {
          expect(schema).toEqual(reviewSchema(inspectCandidate(initial, tokens, {}).units));
          return JSON.stringify({
            issues: [{ ids: ['t0..t3', 't4..t5'], kind: 'alignment', reason: '跨字幕归属错误' }],
          });
        }
        if (stage === 'fixed-id-repair') {
          const targets = JSON.parse(prompt.split('\n').at(-1)!).targets;
          expect(targets.map((u: { id: string }) => u.id)).toEqual(['t0..t3', 't4..t5']);
          return JSON.stringify({
            translations: [
              { id: 't0..t3', translation: '萨姆 最近怎么样' },
              { id: 't4..t5', translation: '你好世界' },
            ],
          });
        }
        return '{"issues":[]}';
      },
    );
    expect(result.repaired).toBe(2);
    expect(result.missing).toEqual([]);
    expect(result.cues.flatMap((c) => c.sourceTokenIds)).toEqual(tokens.map((t) => t.id));
  });
  it('rejects malformed ID arrays but permits overlapping independent issues', () => {
    const candidate = inspectCandidate(initial, tokens, {});
    for (const ids of [[], 't0..t3', ['t0..t3, t4..t5'], ['unknown'], ['t0..t3', 't0..t3'], [1]])
      expect(() =>
        parseReview(
          JSON.stringify({ issues: [{ ids, kind: 'alignment', reason: 'x' }] }),
          candidate.units,
        ),
      ).toThrow();
    expect(
      parseReview(
        JSON.stringify({
          issues: [
            { ids: ['t0..t3'], kind: 'meaning', reason: 'x' },
            { ids: ['t0..t3', 't4..t5'], kind: 'alignment', reason: 'y' },
          ],
        }),
        candidate.units,
      ),
    ).toHaveLength(2);
  });
  it('does not accept half of a repair still rejected as a cross-caption issue', async () => {
    const crossIssue = JSON.stringify({
      issues: [{ ids: ['t0..t3', 't4..t5'], kind: 'alignment', reason: '语义仍错位' }],
    });
    const result = await recoverCandidate(initial, tokens, {}, {}, async (stage) => {
      if (stage === 'fixed-id-repair')
        return JSON.stringify({
          translations: [
            { id: 't0..t3', translation: '萨姆 最近怎么样' },
            { id: 't4..t5', translation: '你好世界' },
          ],
        });
      return crossIssue;
    });
    expect(result.repaired).toBe(0);
    expect(result.missing).toEqual(['t0..t3', 't4..t5']);
  });
  it('applies the shared quote rule to fixed-ID fallback translation', () => {
    const candidate = inspectCandidate(initial, tokens, {});
    expect(fixedPrompt(candidate.units, candidate, {}, {})).toContain(TRANSLATION_QUOTE_RULE);
  });
  it('does not call semantic coverage proven just because indices are complete', async () => {
    const stages: string[] = [];
    const result = await recoverCandidate(initial, tokens, {}, {}, async (stage) => {
      stages.push(stage);
      if (stage === 'semantic-review') return review;
      if (stage === 'fixed-id-repair')
        return JSON.stringify({ translations: [{ id: 't0..t3', translation: '萨姆 最近怎么样' }] });
      return '{"issues":[]}';
    });
    expect(result.cues[0]?.translation).toBe('萨姆 最近怎么样');
    expect(result.repaired).toBe(1);
    expect(result.missing).toEqual([]);
    expect(stages).toEqual(['semantic-review', 'fixed-id-repair', 'verify-repair']);
  });
  it('preserves unrelated accepted cues when local repair fails', async () => {
    const result = await recoverCandidate(initial, tokens, {}, {}, async (stage) => {
      if (stage === 'semantic-review') return review;
      throw new Error('timeout');
    });
    expect(result.cues.map((cue) => cue.translation)).toEqual(['你好世界']);
    expect(result.missing).toEqual(['t0..t3']);
  });
  it('does not erase existing candidates on reviewer failure', async () => {
    const result = await recoverCandidate(initial, tokens, {}, {}, async () => {
      throw new Error('network');
    });
    expect(result.cues).toHaveLength(2);
    expect(result.reviewComplete).toBe(false);
    expect(result.warnings.join(' ')).toContain('未完成');
  });
  it('does not commit a repair still rejected by semantic verification', async () => {
    const result = await recoverCandidate(initial, tokens, {}, {}, async (stage) =>
      stage === 'fixed-id-repair'
        ? JSON.stringify({ translations: [{ id: 't0..t3', translation: '萨姆' }] })
        : review,
    );
    expect(result.repaired).toBe(0);
    expect(result.cues).toHaveLength(1);
    expect(result.missing).toHaveLength(1);
  });
  it('rejects duplicate, unknown, and missing IDs without mutating the old candidate', () => {
    const candidate = inspectCandidate(initial, tokens, {});
    const snapshot = JSON.stringify(candidate);
    for (const translations of [
      [],
      [{ id: 'unknown', translation: '你好' }],
      [
        { id: 't0..t3', translation: '你好' },
        { id: 't0..t3', translation: '你好' },
      ],
    ]) {
      expect(() =>
        applyFixedTranslations(
          JSON.stringify({ translations }),
          candidate,
          [candidate.units[0]!],
          tokens,
          {},
        ),
      ).toThrow();
    }
    expect(JSON.stringify(candidate)).toBe(snapshot);
    expect(() =>
      parseReview('{"issues":[{"id":"no","kind":"omission","reason":"x"}]}', candidate.units),
    ).toThrow();
  });
  it('does not guess the mapping of an out-of-range candidate', () => {
    const candidate = inspectCandidate(
      '{"units":[{"startIndex":0,"endIndex":76,"translation":"错误","sentenceEnd":true}]}',
      tokens,
      {},
    );
    expect(candidate.units.every((unit) => !unit.cue)).toBe(true);
    expect(candidate.units[0]?.translation).toBe('');
  });
  it('replans invalid structure semantically before fixed-ID translation, without reviewing empty output', async () => {
    const stages: string[] = [];
    const result = await recoverCandidate('{"units":[', tokens, {}, {}, async (stage) => {
      stages.push(stage);
      if (stage === 'recovery-plan') return '{"endIndices":[3,5]}';
      if (stage === 'fixed-id-repair')
        return JSON.stringify({
          translations: [
            { id: 't0..t3', translation: 'Sam 最近怎么样' },
            { id: 't4..t5', translation: '你好世界' },
          ],
        });
      return '{"issues":[]}';
    });
    expect(stages).toEqual(['recovery-plan', 'fixed-id-repair', 'verify-repair']);
    expect(result.missing).toEqual([]);
    expect(result.cues.flatMap((c) => c.sourceTokenIds)).toEqual(tokens.map((t) => t.id));
    expect(result.structuralRecovery).toBe(true);
    expect(result.reviewComplete).toBe(true);
  });
  it('does not translate the whole window as a single fallback after an invalid recovery plan', async () => {
    const stages: string[] = [];
    const result = await recoverCandidate('broken', tokens, {}, {}, async (stage) => {
      stages.push(stage);
      return '{"endIndices":[3,99]}';
    });
    expect(stages).toEqual(['recovery-plan']);
    expect(result.cues).toEqual([]);
    expect(result.missing).toHaveLength(1);
    for (const endIndices of [[], [2], [3, 3, 5], [4, 2, 5], [-1, 5], [0.5, 5]])
      expect(() => parseRecoveryPlan(JSON.stringify({ endIndices }), tokens)).toThrow();
  });
  it('isolates a name omission without dropping other units', () => {
    const entityTokens = ['versions', 'of', 'Astra.', 'Hello', 'world.'].map((text, i) => ({
      ...tokens[i]!,
      text,
    }));
    const raw = JSON.stringify({
      units: [
        { startIndex: 0, endIndex: 2, translation: '就像会有', sentenceEnd: true },
        { startIndex: 3, endIndex: 4, translation: '你好世界', sentenceEnd: true },
      ],
    });
    const candidate = inspectCandidate(raw, entityTokens, {});
    expect(candidate.units[0]?.error).toContain('Astra');
    expect(candidate.units[1]?.cue?.translation).toBe('你好世界');
  });
});

const directory = '.eval/experiments/semantic-windows-20260903/C-planned';
describe.skipIf(!existsSync(`${directory}/result.json`))(
  'saved-response regression without API calls',
  () => {
    const load = () => JSON.parse(readFileSync(`${directory}/result.json`, 'utf8')) as EvalRun;
    function first(start: number) {
      const run = load(),
        window = run.windows.find((w) => w.startMs === start)!;
      const request = run.results[window.id]![0]!.requests[0]!;
      const trace = JSON.parse(readFileSync(`${directory}/requests/${request.id}.json`, 'utf8'));
      const context = JSON.parse(
        trace.request.messages[1].content
          .split('\n')
          .find((line: string) => line.startsWith('{') && line.includes('"previousCues"')),
      );
      return { window, raw: trace.response.choices[0].message.content as string, context };
    }
    it('retains the original 48:31 translation despite its 33-character cue', () => {
      const { window, raw, context } = first(2911680);
      const candidate = inspectCandidate(raw, window.tokens, context);
      expect(candidate.units).toHaveLength(4);
      expect(candidate.units.every((u) => u.cue)).toBe(true);
      expect(candidate.warnings.some((w) => w.includes('33'))).toBe(true);
    });
    it('treats a trailing discourse marker as a display warning', () => {
      const { window, raw, context } = first(1324480);
      const candidate = inspectCandidate(raw, window.tokens, context);
      expect(candidate.units.every((u) => u.cue)).toBe(true);
      expect(candidate.warnings.some((w) => w.includes('口语停顿'))).toBe(true);
    });
    it('keeps real missing-name errors local', () => {
      const { window, raw, context } = first(792480);
      const candidate = inspectCandidate(raw, window.tokens, context);
      expect(candidate.units.filter((u) => u.cue).length).toBeGreaterThan(0);
      expect(candidate.units.some((u) => u.error?.includes('Astra'))).toBe(true);
    });
    it('shows accepted partial cues and counts their missing source honestly', () => {
      const run = load(),
        window = run.windows[0]!;
      run.windows = [window];
      const current = run.results[window.id]![0]!;
      current.status = 'partial';
      current.cues = current.cues.slice(0, 1);
      expect(successfulCues(run)).toHaveLength(1);
      expect(summarize(run).partialWindows).toBe(1);
      expect(summarize(run).successfulWindows).toBe(0);
      expect(summarize(run).missingTokens).toBe(window.tokens.length - 4);
    });
  },
);
