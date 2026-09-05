import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hash, PROJECT_ROOT } from './io';

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
