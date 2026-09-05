import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hash, PROJECT_ROOT } from './io';
import { DIMENSIONS, TRANSLATION_RUBRIC, TRANSLATION_RUBRIC_HASH } from './translation-scoring';

await mkdir(path.join(PROJECT_ROOT, '.eval'), { recursive: true });
const temporary = await mkdtemp(path.join(PROJECT_ROOT, '.eval', 'benchmark-report-test-'));
afterAll(async () => {
  const relative = path.relative(PROJECT_ROOT, temporary).replaceAll('\\', '/');
  if (!relative.startsWith('.eval/benchmark-report-test-')) throw new Error('Unsafe test cleanup');
  await rm(temporary, { recursive: true, force: true });
});

async function fixture(name: string) {
  const root = path.join(temporary, name);
  await mkdir(path.join(root, 'inputs'), { recursive: true });
  const token = { id: 't0', cueId: 'c0', text: 'Hello', startMs: 0, endMs: 1000 };
  const input = JSON.stringify({
    videoId: 'test-video',
    timing: 'test',
    tokens: [token],
    scoreTokenIds: ['t0'],
  });
  const reference = JSON.stringify({
    version: 'test-reference',
    status: 'test',
    cases: [
      {
        id: 'case',
        label: 'test',
        inputSha256: hash(input),
        referenceTranslation: '你好',
        meaningUnits: [{ id: 'm1', meaning: '问候' }],
        acceptableVariants: [],
        boundaryNotes: [],
      },
    ],
  });
  const run = {
    fingerprint: 'run-test',
    status: 'completed',
    identity: { model: 'test', entrypoint: 'test' },
    selected: [{ id: 'case', split: 'development', tier: 'primary' }],
    results: {
      case: [
        {
          status: 'success',
          inputSha256: hash(input),
          durationMs: 1,
          attempts: [],
          missingScoreTokens: [],
          cues: [
            {
              id: 'c0',
              sourceTokenIds: ['t0'],
              startMs: 0,
              endMs: 1000,
              sourceText: 'Hello',
              translation: '你好',
            },
          ],
        },
      ],
    },
  };
  const judgment = {
    reviewer: 'test',
    runFingerprint: 'run-test',
    runResultSha256: hash(JSON.stringify(run)),
    referenceSha256: hash(reference),
    cases: [
      {
        id: 'case',
        meaningVerdicts: ['pass'],
        fluency: 5,
        verdict: 'usable',
        notes: 'test',
        issues: [],
      },
    ],
  };
  for (const [file, value] of Object.entries({
    'inputs/case.json': input,
    'references.json': reference,
    'reference-lock.json': JSON.stringify({ sha256: hash(reference) }),
    'result.json': JSON.stringify(run),
    'summary.json': '{}',
    'judgments.json': JSON.stringify(judgment),
  }))
    await writeFile(path.join(root, file), value);
  const invoke = () =>
    spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/report-translation-benchmark.ts',
        '--run',
        root,
        '--references',
        path.join(root, 'references.json'),
        '--judgments',
        path.join(root, 'judgments.json'),
        '--out',
        path.join(root, 'report'),
      ],
      { cwd: PROJECT_ROOT, encoding: 'utf8' },
    );
  return { root, run, judgment, invoke };
}

describe('reference assessment evidence integrity', () => {
  it('renders a matching assessment without model calls', async () => {
    const f = await fixture('valid');
    const result = f.invoke();
    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(await readFile(path.join(f.root, 'report/summary.json'), 'utf8'));
    expect(summary.quality).toBeNull();
    expect(summary.scoringStatus).toBe('legacy-unscored');
    expect(summary.primary).toMatchObject({
      complete: 1,
      meaningPass: 1,
      meaningPossible: 1,
      unavailable: 0,
    });
  });
  it('rejects a changed reference even when wording would look equivalent', async () => {
    const f = await fixture('changed-reference');
    const ref = path.join(f.root, 'references.json');
    await writeFile(ref, (await readFile(ref, 'utf8')).replace('你好', '您好'));
    const result = f.invoke();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('参考译文已改变');
  });
  it('rejects mismatched model inputs', async () => {
    const f = await fixture('changed-input');
    await writeFile(path.join(f.root, 'inputs/case.json'), '{}');
    const result = f.invoke();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('输入指纹不一致');
  });
  it('does not certify incomplete delivery as usable', async () => {
    const f = await fixture('incomplete');
    f.run.results.case[0]!.status = 'partial';
    await writeFile(path.join(f.root, 'result.json'), JSON.stringify(f.run));
    f.judgment.runResultSha256 = hash(JSON.stringify(f.run));
    await writeFile(path.join(f.root, 'judgments.json'), JSON.stringify(f.judgment));
    const result = f.invoke();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('不完整输出不能标记可用');
  });
  it('rejects annotations attached to another run', async () => {
    const f = await fixture('wrong-run');
    f.judgment.runFingerprint = 'different-run';
    await writeFile(path.join(f.root, 'judgments.json'), JSON.stringify(f.judgment));
    const result = f.invoke();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('评审与冻结的运行/参考不匹配');
  });
  it('rejects stale judgments after outputs change under identical settings', async () => {
    const f = await fixture('stale-output');
    f.run.results.case[0]!.cues[0]!.translation = '再见';
    await writeFile(path.join(f.root, 'result.json'), JSON.stringify(f.run));
    const result = f.invoke();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('评审与运行输出快照不匹配');
  });
});

describe('versioned score reports', () => {
  async function scoredFixture(name: string) {
    const f = await fixture(name);
    const review = {
      ...f.judgment,
      rubricVersion: TRANSLATION_RUBRIC.version,
      rubricSha256: TRANSLATION_RUBRIC_HASH,
      reviewerType: 'agent',
      reviewStatus: 'complete',
      cases: f.judgment.cases.map((c) => ({
        ...c,
        scoreCard: {
          ratings: Object.fromEntries(
            DIMENSIONS.map((d) => [
              d,
              { level: 4, rationale: '合成回归样本逐项核对无错误', issueIds: [] },
            ]),
          ),
          issues: [],
        },
      })),
    };
    const save = () => writeFile(path.join(f.root, 'judgments.json'), JSON.stringify(review));
    await save();
    return { ...f, review, save };
  }
  it('renders four dimensions and video macro scores without changing the legacy format', async () => {
    const f = await scoredFixture('scored');
    const r = f.invoke();
    expect(r.status, r.stderr).toBe(0);
    const summary = JSON.parse(await readFile(path.join(f.root, 'report/summary.json'), 'utf8'));
    expect(summary.quality.primary).toMatchObject({ total: 100, critical: 0, cases: 1 });
    expect(summary.rubricSha256).toBe(TRANSLATION_RUBRIC_HASH);
    expect(summary.cases[0].score.points.accuracy).toBe(40);
  });
  it.each(['draft', 'rubric', 'missing-grade', 'meaning-contradiction', 'invalid-verdict'])(
    'rejects %s reviews before writing results',
    async (reason) => {
      const f = await scoredFixture(`scored-${reason}`);
      if (reason === 'draft') f.review.reviewStatus = 'draft';
      if (reason === 'rubric') f.review.rubricSha256 = 'old';
      if (reason === 'missing-grade') f.review.cases[0]!.scoreCard.ratings.accuracy!.rationale = '';
      if (reason === 'invalid-verdict') f.review.cases[0]!.meaningVerdicts[0] = 'constructor';
      if (reason === 'meaning-contradiction') f.review.cases[0]!.meaningVerdicts[0] = 'fail';
      await f.save();
      expect(f.invoke().status).toBe(1);
    },
  );
  it('creates anonymous pending materials, not automatic scores, and refuses overwrite', async () => {
    const f = await fixture('prepare');
    const args = [
      '--import',
      'tsx',
      'scripts/prepare-translation-review.ts',
      '--run',
      f.root,
      '--references',
      path.join(f.root, 'references.json'),
      '--out',
      path.join(f.root, 'packet'),
    ];
    const invoke = () => spawnSync(process.execPath, args, { cwd: PROJECT_ROOT, encoding: 'utf8' });
    expect(invoke().status).toBe(0);
    const packet = JSON.parse(await readFile(path.join(f.root, 'packet/packet.json'), 'utf8'));
    expect(packet).not.toHaveProperty('identity');
    expect(packet).not.toHaveProperty('runDirectory');
    expect(packet.cases[0]).not.toHaveProperty('durationMs');
    const draft = JSON.parse(
      await readFile(path.join(f.root, 'packet/judgments.template.json'), 'utf8'),
    );
    expect(draft.reviewStatus).toBe('draft');
    expect(draft.cases[0].scoreCard.ratings.accuracy.level).toBeNull();
    await writeFile(path.join(f.root, 'judgments.json'), JSON.stringify(draft));
    expect(f.invoke().status).toBe(1);
    expect(invoke().status).toBe(1);
  });
  it('compares matching formal reports and rejects changed rubric or scope', async () => {
    const a = await scoredFixture('compare-a'),
      b = await scoredFixture('compare-b');
    expect(a.invoke().status).toBe(0);
    expect(b.invoke().status).toBe(0);
    const invoke = (out: string) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/compare-translation-scores.ts',
          '--out',
          path.join(temporary, out),
          path.join(a.root, 'report'),
          path.join(b.root, 'report'),
        ],
        { cwd: PROJECT_ROOT, encoding: 'utf8' },
      );
    expect(invoke('comparison').status).toBe(0);
    const p = path.join(b.root, 'report/summary.json');
    const summary = JSON.parse(await readFile(p, 'utf8'));
    summary.cases[0].inputSha256 = 'other';
    await writeFile(p, JSON.stringify(summary));
    expect(invoke('comparison-invalid').status).toBe(1);
    summary.cases[0].inputSha256 = a.run.results.case[0]!.inputSha256;
    summary.rubricSha256 = 'different';
    await writeFile(p, JSON.stringify(summary));
    expect(invoke('comparison-rubric').status).toBe(1);
  });
});
