import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { acquireLock, hash, pipelineHash, readRun, redact, writeJson } from './eval/io';
import { summarize } from './eval/analysis';
import { currentAttempt, successfulCues, type Attempt, type EvalRun } from './eval/types';
import { continuousWindowGroups, repairAcrossSeams } from './eval/continuous-boundaries';
import { planRollingSeams } from './eval/rolling-seams';
import { translateResilient } from './eval/resilient-translation';
import { repairDisplayBoundaries } from './eval/boundary-repair';
import { assertExactCoverage, surroundingSource, type Episode } from './eval/window-experiment';
import { jsonClient } from './eval/json-client';
import { writeComparison, writeReport } from './eval/report';
import type { RequestBudget } from './eval/trace';
const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    'token-file': { type: 'string' },
    'max-requests': { type: 'string', default: '80' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
const makeAttempt = (context: object): Attempt => ({
  id: randomUUID(),
  contextHash: hash(context),
  status: 'running',
  startedAt: new Date().toISOString(),
  durationMs: 0,
  stages: [],
  diagnostics: [],
  requests: [],
  cues: [],
});
let secret = '';
async function main() {
  if (values.help) {
    console.info(
      '连续规划与跨窗联合复核\nnode --import tsx scripts/experiment-continuous.ts --out <新目录> --token-file <密钥文件> [--max-requests 80] [--dry-run]\n处理前八个原始窗口。G2-reference 为历史参考；H-translation 连续规划后重新翻译；H-refined 追加原 G2 局部修复；G2-joint-replay 只回放旧片段接缝。保持 G2 提示词，使用 gpt.ge 的 Gemini 3.5 Flash Lite。所有新增调用共享请求上限；不支持续跑。',
    );
    return;
  }
  if (!values.out) throw new Error('缺少 --out。运行 --help 查看用法。');
  const limit = Number(values['max-requests']);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('请求上限必须为正整数。');
  const baselinePath = '.eval/runs/compare-gemini-3.5-flash-lite',
    oldPath = '.eval/experiments/rolling-boundaries-20260903/G2-guarded';
  const baseline = await readRun(baselinePath),
    old = await readRun(oldPath);
  if (hash(baseline.tokens) !== hash(old.tokens) || old.identity.model !== 'gemini-3.5-flash-lite')
    throw new Error('历史来源的原文或模型不匹配。');
  const selected = baseline.windows.slice(0, 8),
    groups = continuousWindowGroups(baseline.tokens, selected);
  if (groups.length !== 1 || selected.length !== 8)
    throw new Error('前八窗不是同一个连续原文范围。');
  const tokens = selected.flatMap((w) => w.tokens),
    context = old.identity.context;
  const oldWindows = old.windows.filter(
    (w) => w.startMs >= tokens[0]!.startMs && w.endMs <= tokens.at(-1)!.endMs,
  );
  assertExactCoverage(tokens, oldWindows);
  const anchors = oldWindows.slice(1).map((w) => w.tokens[0]!.id);
  const cases = [
    ...old.cases.filter((c) => c.startMs < tokens.at(-1)!.endMs),
    {
      id: 'heights',
      label: 'new heights 跨片段搭配',
      startMs: 115200,
      endMs: 119119,
      review: 'new heights 完整表达，不重复新的，不单独闪现 heights。',
    },
  ];
  const episode: Episode = {
    id: 'continuous',
    tokens,
    windows: groups[0]!,
    context,
    review: {
      id: 'continuous',
      label: '连续范围',
      startMs: tokens[0]!.startMs,
      endMs: tokens.at(-1)!.endMs,
      review: '',
    },
  };
  console.info(
    `连续范围 ${tokens[0]!.startMs}—${tokens.at(-1)!.endMs}ms · ${tokens.length} 词元 · ${selected.length} 原始窗口 · 旧片段接缝 ${anchors.length} 个 · 上限 ${limit} 次新请求`,
  );
  if (values['dry-run']) {
    console.info('覆盖检查通过；未读取密钥、写入目录或请求模型。');
    return;
  }
  if (!values['token-file']) throw new Error('缺少 --token-file。');
  secret = (await readFile(values['token-file'], 'utf8')).trim();
  if (!secret) throw new Error('密钥文件为空。');
  const root = path.resolve(values.out);
  await mkdir(path.dirname(root), { recursive: true });
  await mkdir(root);
  const unlock = await acquireLock(root),
    controller = new AbortController(),
    budget: RequestBudget = { used: 0, limit, exhausted: false };
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const begin = performance.now();
  try {
    const files = [
      'experiment-continuous.ts',
      'eval/continuous-boundaries.ts',
      'eval/rolling-seams.ts',
      'eval/boundary-repair.ts',
      'eval/resilient-translation.ts',
      'eval/seam-planner.ts',
      'eval/window-experiment.ts',
      'eval/json-client.ts',
      'eval/complete-output.ts',
    ];
    const sourceHash = await pipelineHash(),
      experimentHash = hash(
        await Promise.all(files.map((f) => readFile(new URL(f, import.meta.url), 'utf8'))),
      );
    const manifest = {
      createdAt: new Date().toISOString(),
      baselinePath: path.resolve(baselinePath),
      oldPath: path.resolve(oldPath),
      oldFingerprint: old.fingerprint,
      sourceHash,
      experimentHash,
      model: old.identity.model,
      endpoint: 'https://api.gpt.ge/v1/chat/completions',
      requestLimit: limit,
      contextPolicy:
        'Same saved video evidence and aliases; source neighbors; H previous six accepted cues across the entire continuous span. No historical Chinese translations in H initial context.',
      definitions: {
        reference: 'Historical G2 output for identical source span, no new requests.',
        translation:
          'Fresh rolling plan for all eight adjacent source windows, followed by fresh translation. G2 translation prompt unchanged.',
        refined:
          'Reuse H output and run unchanged G2 boundary repair over the complete continuous span. Incremental cost only.',
        joint:
          'Reuse historical G2 output, jointly review up to three display cues on either side of each old clip seam. No fresh whole-window translation. Incremental cost only.',
      },
      cases,
      originalSeams: anchors,
    };
    await writeJson(path.join(root, 'manifest.json'), manifest);
    await mkdir(path.join(root, 'source'));
    await Promise.all(
      files.map((f) =>
        copyFile(new URL(f, import.meta.url), path.join(root, 'source', path.basename(f))),
      ),
    );
    const dirs = {
      reference: path.join(root, 'G2-reference'),
      translation: path.join(root, 'H-translation'),
      refined: path.join(root, 'H-refined'),
      joint: path.join(root, 'G2-joint-replay'),
    };
    await Promise.all(
      Object.values(dirs).map((d) => mkdir(path.join(d, 'requests'), { recursive: true })),
    );
    const fresh = (name: string, windows: EvalRun['windows']): EvalRun => ({
      ...baseline,
      id: randomUUID(),
      name,
      fingerprint: hash([manifest, name]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      identity: {
        ...old.identity,
        context,
        pipelineHash: sourceHash,
        windowIds: windows.map((w) => w.id),
      },
      windows,
      results: {},
      cases,
      entityAttempts: [],
      planningAttempts: [],
    });
    const reference: EvalRun = {
      ...old,
      name: 'G2-reference · 历史输出',
      windows: oldWindows,
      identity: { ...old.identity, windowIds: oldWindows.map((w) => w.id) },
      results: Object.fromEntries(oldWindows.map((w) => [w.id, old.results[w.id]!])),
      cases,
    };
    await writeJson(path.join(dirs.reference, 'result.json'), reference);
    for (const req of Object.values(reference.results)
      .flat()
      .flatMap((a) => a.requests))
      await copyFile(
        path.join(oldPath, 'requests', `${req.id}.json`),
        path.join(dirs.reference, 'requests', `${req.id}.json`),
      );
    await writeReport(dirs.reference);
    const span = {
      id: 'span:continuous',
      startMs: tokens[0]!.startMs,
      endMs: tokens.at(-1)!.endMs,
      tokens,
    };
    const joint = fresh('G2-joint-replay · 旧接缝回放', [span]);
    const jointAttempt = makeAttempt(context);
    jointAttempt.cues = successfulCues(reference);
    jointAttempt.status = 'success';
    joint.results[span.id] = [jointAttempt];
    const h = fresh('H-translation · 连续规划', selected);
    const stopped = () => controller.signal.aborted || budget.exhausted || budget.used >= limit;
    const save = async (directory: string, run: EvalRun) => {
      run.updatedAt = new Date().toISOString();
      run.identity.windowIds = run.windows.map((w) => w.id);
      await writeJson(path.join(directory, 'result.json'), run, secret);
    };
    let jointDetails: Awaited<ReturnType<typeof repairAcrossSeams>>['details'] = [];
    let steps: Awaited<ReturnType<typeof planRollingSeams>>['steps'] = [];
    const recovery: Array<{
      windowId: string;
      result: Awaited<ReturnType<typeof translateResilient>>;
    }> = [];
    const settled = await Promise.allSettled([
      (async () => {
        await save(dirs.joint, joint);
        const start = performance.now();
        const result = await repairAcrossSeams(
          jointAttempt.cues,
          baseline.tokens,
          context,
          anchors,
          jsonClient(dirs.joint, jointAttempt, 'old-seam', secret, budget, controller),
          async (cues, details) => {
            jointAttempt.cues = cues;
            jointDetails = details;
            await save(dirs.joint, joint);
            await writeJson(path.join(dirs.joint, 'joint.json'), details, secret);
          },
        );
        jointAttempt.cues = result.cues;
        jointAttempt.durationMs = Math.round(performance.now() - start);
        joint.status = stopped() ? 'paused' : 'completed';
        await save(dirs.joint, joint);
        await writeReport(dirs.joint);
        console.info(
          `旧接缝回放 · ${jointAttempt.requests.length} 新请求 · ${result.details.map((d) => d.status).join(',')}`,
        );
      })(),
      (async () => {
        const planning = makeAttempt(context);
        h.planningAttempts!.push(planning);
        await save(dirs.translation, h);
        const start = performance.now();
        const plan = await planRollingSeams(
          episode,
          baseline.tokens,
          jsonClient(dirs.translation, planning, 'continuous', secret, budget, controller),
          async (windows, current) => {
            h.windows = windows;
            steps = current;
            await save(dirs.translation, h);
            await writeJson(
              path.join(dirs.translation, 'plans.json'),
              [{ episode: 'continuous', windows, steps }],
              secret,
            );
          },
        );
        h.windows = plan.windows;
        steps = plan.steps;
        planning.status = steps.some((s) => s.fallback) ? 'failed' : 'success';
        planning.durationMs = Math.round(performance.now() - start);
        await save(dirs.translation, h);
        for (const window of h.windows) {
          if (stopped()) break;
          const local = {
            ...context,
            previousCues: successfulCues(h)
              .slice(-6)
              .map((c) => ({ sourceText: c.sourceText, translation: c.translation })),
          };
          const active = makeAttempt(local);
          h.results[window.id] = [active];
          await save(dirs.translation, h);
          const start = performance.now();
          try {
            const result = await translateResilient(
              window.tokens,
              local,
              surroundingSource(baseline.tokens, window.tokens),
              jsonClient(dirs.translation, active, window.id, secret, budget, controller),
            );
            active.cues = result.cues;
            active.status = result.missing.length
              ? result.cues.length
                ? 'partial'
                : 'failed'
              : 'success';
            active.diagnostics = result.warnings.map((message) => ({ kind: 'fallback', message }));
            recovery.push({ windowId: window.id, result });
          } catch (error) {
            active.status = stopped() ? 'interrupted' : 'failed';
            active.error = redact(String(error), secret);
          }
          active.durationMs = Math.round(performance.now() - start);
          await save(dirs.translation, h);
          await writeJson(path.join(dirs.translation, 'recovery.json'), recovery, secret);
          console.info(
            `H · ${window.startMs}—${window.endMs}ms · ${active.status} · ${active.requests.length} 请求`,
          );
        }
        h.status = stopped()
          ? 'paused'
          : h.windows.every((w) => currentAttempt(h, w.id)?.status === 'success')
            ? 'completed'
            : 'completed-with-errors';
        await save(dirs.translation, h);
        await writeReport(dirs.translation);
      })(),
    ]);
    const errors = settled.flatMap((r) =>
      r.status === 'rejected' ? [redact(String(r.reason), secret)] : [],
    );
    const refined = fresh('H-refined · 连续范围 G2 修复', [span]);
    const refinement = makeAttempt(context);
    refinement.cues = successfulCues(h);
    refinement.status =
      hash(refinement.cues.flatMap((c) => c.sourceTokenIds)) === hash(tokens.map((t) => t.id))
        ? 'success'
        : refinement.cues.length
          ? 'partial'
          : 'failed';
    refined.results[span.id] = [refinement];
    await save(dirs.refined, refined);
    let refinedResult: Awaited<ReturnType<typeof repairDisplayBoundaries>> | undefined;
    if (!stopped() && !errors.length) {
      const start = performance.now();
      refinedResult = await repairDisplayBoundaries(
        refinement.cues,
        baseline.tokens,
        context,
        h.windows.slice(0, -1).map((w) => w.endMs),
        jsonClient(dirs.refined, refinement, 'continuous', secret, budget, controller),
      );
      refinement.cues = refinedResult.cues;
      refinement.durationMs = Math.round(performance.now() - start);
      refinement.diagnostics = refinedResult.warnings.map((message) => ({
        kind: 'fallback',
        message,
      }));
      await writeJson(path.join(dirs.refined, 'repairs.json'), refinedResult, secret);
    }
    refined.status =
      !refinedResult || stopped()
        ? 'paused'
        : refinement.status === 'success'
          ? 'completed'
          : 'completed-with-errors';
    await save(dirs.refined, refined);
    await writeReport(dirs.refined);
    await writeJson(
      path.join(root, 'summary.json'),
      {
        wallMs: Math.round(performance.now() - begin),
        newRequests: budget.used,
        errors,
        H: summarize(h),
        refinedIncremental: summarize(refined),
        jointIncremental: summarize(joint),
        planningFallbacks: steps.filter((s) => s.fallback),
        unreviewedTranslation: recovery
          .filter((r) => !r.result.reviewComplete)
          .map((r) => r.windowId),
        refinedReviewComplete: refinedResult?.reviewComplete ?? false,
        refinedApplied: refinedResult?.repairs.filter((r) => r.status === 'applied').length ?? 0,
        refinedRetained: refinedResult?.repairs.filter((r) => r.status === 'retained').length ?? 0,
        joint: jointDetails,
      },
      secret,
    );
    await writeComparison(dirs.reference, dirs.refined, path.join(root, 'G2-vs-H'));
    await writeComparison(dirs.reference, dirs.joint, path.join(root, 'G2-vs-joint'));
    await writeComparison(dirs.translation, dirs.refined, path.join(root, 'H-raw-vs-refined'));
    console.info(
      JSON.stringify({
        root,
        newRequests: budget.used,
        errors,
        missing: [
          summarize(h).missingTokens,
          summarize(refined).missingTokens,
          summarize(joint).missingTokens,
        ],
      }),
    );
    if (errors.length || stopped()) process.exitCode = 1;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await unlock();
  }
}
main().catch((error) => {
  console.error(redact(String(error), secret));
  process.exitCode = 1;
});
