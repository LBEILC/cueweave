import { describe, expect, it } from 'vitest';
import {
  aggregateScores,
  DIMENSIONS,
  scoreTranslation,
  type ScoreCard,
  type ScoreIssue,
} from './translation-scoring';

const input = {
  tokens: [
    { id: 't0', text: 'Do' },
    { id: 't1', text: 'not' },
    { id: 't2', text: 'go' },
    { id: 'padding', text: 'Hello' },
  ],
  scoreTokenIds: ['t0', 't1', 't2'],
};
const cues = [{ sourceTokenIds: ['t0', 't1', 't2'], translation: '不要去' }];
const rating = () => ({ level: 4, rationale: '逐条对照，未发现问题', issueIds: [] as string[] });
const card = (): ScoreCard => ({
  ratings: { accuracy: rating(), completeness: rating(), alignment: rating(), fluency: rating() },
  issues: [],
});
const issue = (patch: Partial<ScoreIssue> = {}): ScoreIssue => ({
  id: 'e1',
  dimensions: ['accuracy'],
  severity: 'critical',
  sourceTokenIds: ['t0', 't1', 't2'],
  cueIndices: [0],
  sourceQuote: 'Do not go',
  translationQuote: '去',
  explanation: '遗漏否定，使行动含义反转',
  ...patch,
});
function criticalCard() {
  const c = card();
  c.issues = [issue()];
  c.ratings.accuracy = { level: 1, rationale: '关键否定翻反', issueIds: ['e1'] };
  return c;
}

describe('translation rubric scoring', () => {
  it('calculates weighted points and preserves a severe-error gate independently', () => {
    expect(scoreTranslation(card(), input, cues)).toMatchObject({ total: 100, gate: 'strong' });
    expect(
      scoreTranslation(criticalCard(), input, [{ ...cues[0]!, translation: '去' }]),
    ).toMatchObject({
      total: 70,
      critical: 1,
      gate: 'needs-fix',
      points: { accuracy: 10, completeness: 25, alignment: 20, fluency: 15 },
    });
  });
  it('does not let high weighted totals hide a major fluency error', () => {
    const c = card();
    c.issues = [
      issue({
        dimensions: ['fluency'],
        severity: 'major',
        translationQuote: '不要去',
        explanation: '用于验证权重与门槛独立的合成例子',
      }),
    ];
    c.ratings.fluency = { level: 2, rationale: '合成评分', issueIds: ['e1'] };
    expect(scoreTranslation(c, input, cues)).toMatchObject({
      total: 92.5,
      gate: 'needs-fix',
      major: 1,
    });
  });
  it.each([null, -1, 5, 3.5, NaN])('rejects incomplete or invalid level %s', (level) => {
    const c = card();
    c.ratings.accuracy.level = level;
    expect(() => scoreTranslation(c, input, cues)).toThrow('0–4');
  });
  it('requires evidence for deductions and rejects unknown issue references', () => {
    const c = card();
    c.ratings.accuracy.level = 3;
    expect(() => scoreTranslation(c, input, cues)).toThrow('证据');
    c.ratings.accuracy.issueIds = ['missing'];
    expect(() => scoreTranslation(c, input, cues)).toThrow('未知');
  });
  it.each([
    { sourceQuote: 'Invented source' },
    { translationQuote: '伪造引文' },
    { cueIndices: [999] },
    { sourceTokenIds: ['unknown'] },
    { sourceTokenIds: ['padding'], sourceQuote: 'Hello' },
    { cueIndices: [], translationQuote: '' },
  ])('rejects fabricated or out-of-scope evidence %j', (patch) => {
    const c = criticalCard();
    c.issues = [issue(patch)];
    expect(() => scoreTranslation(c, input, cues)).toThrow('评分校验');
  });
  it('rejects contradictory high ratings and duplicated issue IDs', () => {
    const c = criticalCard();
    c.ratings.accuracy.level = 4;
    expect(() => scoreTranslation(c, input, cues)).toThrow('矛盾');
    c.issues.push(c.issues[0]!);
    expect(() => scoreTranslation(c, input, cues)).toThrow('重复');
  });
  it('keeps partial delivery from receiving a total and does not require padding coverage', () => {
    const c = card();
    c.ratings.completeness = { level: 1, rationale: '未产出否定和动作', issueIds: ['missing'] };
    c.issues = [
      issue({
        id: 'missing',
        dimensions: ['completeness'],
        severity: 'major',
        sourceTokenIds: ['t1', 't2'],
        sourceQuote: 'not go',
        cueIndices: [],
        translationQuote: '',
        explanation: '未产出',
      }),
    ];
    expect(
      scoreTranslation(c, input, [{ sourceTokenIds: ['t0'], translation: '做' }]),
    ).toMatchObject({ total: null, gate: 'incomplete', missingTokenIds: ['t1', 't2'] });
    expect(scoreTranslation(card(), input, cues).total).toBe(100);
  });
  it('marks empty delivery unassessable instead of silently filling perfect grades', () => {
    const c = card();
    for (const d of DIMENSIONS) c.ratings[d].level = d === 'completeness' ? 0 : null;
    expect(scoreTranslation(c, input, [])).toMatchObject({
      total: null,
      points: { accuracy: null, completeness: 0, alignment: null, fluency: null },
      coverage: 0,
    });
    expect(() => scoreTranslation(card(), input, [])).toThrow('无可用译文');
  });
  it('rejects duplicate and invented output ownership', () => {
    expect(() => scoreTranslation(card(), input, [...cues, ...cues])).toThrow('重复覆盖');
    expect(() =>
      scoreTranslation(card(), input, [{ sourceTokenIds: ['alien'], translation: '你好' }]),
    ).toThrow('未知');
  });
  it('averages videos equally and never drops incomplete videos', () => {
    const good = scoreTranslation(card(), input, cues),
      bad = scoreTranslation(criticalCard(), input, [{ ...cues[0]!, translation: '去' }]);
    const rows = [
      { videoId: 'a', score: good },
      { videoId: 'a', score: good },
      { videoId: 'b', score: bad },
    ];
    expect(aggregateScores(rows)).toMatchObject({ total: 85, critical: 1, needsFixCases: 1 });
    rows[2]!.score = { ...bad, total: null, gate: 'incomplete' };
    expect(aggregateScores(rows)).toMatchObject({ total: null, incompleteCases: 1 });
    expect(aggregateScores([]).total).toBeNull();
  });
});
