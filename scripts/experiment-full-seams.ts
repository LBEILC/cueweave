import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { DisplayCue, TokenWindow } from '@cueweave/core/subtitle';
import { AI_PROMPT_VERSION, DISPLAY_SEGMENTATION_VERSION } from '@cueweave/core/subtitle/ai';
import { acquireLock, hash, pipelineHash, readRun, redact, writeJson } from './eval/io';
import { summarize } from './eval/analysis';
import { fullEpisodes, runWorkers } from './eval/full-seams';
import { jsonClient } from './eval/json-client';
import { parseSeam, seamPrompt, SEAM_SCHEMA } from './eval/seam-planner';
import { translateResilient, type ResilientResult } from './eval/resilient-translation';
import { assertExactCoverage, surroundingSource } from './eval/window-experiment';
import { writeReport } from './eval/report';
import { currentAttempt, type Attempt, type EvalRun } from './eval/types';
import type { RequestBudget } from './eval/trace';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    'token-file': { type: 'string' },
    'max-requests': { type: 'string', default: '700' },
    concurrency: { type: 'string', default: '2' },
    resume: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
interface Plan {
  episode: string;
  done: boolean;
  fallback?: string;
  attemptId?: string;
  windows: TokenWindow[];
}
interface Detail {
  attemptId: string;
  episode: string;
  windowId: string;
  result: ResilientResult;
}
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
      'E-seams 全片评测\nnode --import tsx scripts/experiment-full-seams.ts --out <运行目录> --token-file <密钥文件> [--max-requests 700] [--concurrency 2] [--resume] [--dry-run]\n使用 gpt.ge 的 Gemini 3.5 Flash Lite；参数上限包含规划、复核、修复和截断重试。--resume 仅复用同一源码与上下文下完整产出且复核完成的窗口。',
    );
    return;
  }
  if (!values.out) throw new Error('缺少 --out。运行 --help 查看用法。');
  const limit = Number(values['max-requests']),
    concurrency = Number(values.concurrency);
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 4
  )
    throw new Error('请求上限必须为正整数，并发数必须为 1—4。');
  const baselinePath = '.eval/runs/compare-gemini-3.5-flash-lite';
  const baseline = await readRun(baselinePath);
  if (baseline.videoId !== 'VeizK1M7V7E' || baseline.identity.model !== 'gemini-3.5-flash-lite')
    throw new Error('基线视频或模型不匹配。');
  const episodes = fullEpisodes(baseline);
  const directory = path.resolve(values.out);
  const files = [
    'experiment-full-seams.ts',
    'eval/full-seams.ts',
    'eval/json-client.ts',
    'eval/resilient-translation.ts',
    'eval/complete-output.ts',
    'eval/seam-planner.ts',
    'eval/window-experiment.ts',
  ];
  const sourceHash = await pipelineHash();
  const experimentHash = hash(
    await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8'))),
  );
  const fingerprint = hash([
    baseline.identity.inputHash,
    baseline.tokens,
    baseline.windows,
    episodes[0]!.context,
    sourceHash,
    experimentHash,
  ]);
  console.info(
    `E-seams 全片 · ${baseline.tokens.length} 词元 · ${baseline.windows.length} 原始窗口 · ${episodes.length} 组 · 上限 ${limit} 请求 · 并发 ${concurrency}`,
  );
  if (values['dry-run']) {
    console.info('输入完整覆盖检查通过；未读取密钥、写入目录或请求模型。');
    return;
  }
  if (!values['token-file']) throw new Error('缺少 --token-file。');
  secret = (await readFile(values['token-file'], 'utf8')).trim();
  if (!secret) throw new Error('密钥文件为空。');
  if (!values.resume) {
    await mkdir(path.dirname(directory), { recursive: true });
    await mkdir(directory);
  }
  const unlock = await acquireLock(directory);
  const controller = new AbortController(),
    budget: RequestBudget = { used: 0, limit, exhausted: false };
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  let queue = Promise.resolve();
  try {
    let run: EvalRun, plans: Plan[], details: Detail[];
    if (values.resume) {
      run = await readRun(directory);
      if (run.fingerprint !== fingerprint)
        throw new Error('源码、输入或上下文已改变，不能续跑；请使用新目录。');
      plans = JSON.parse(await readFile(path.join(directory, 'plans.json'), 'utf8'));
      details = JSON.parse(await readFile(path.join(directory, 'recovery.json'), 'utf8'));
    } else {
      run = {
        ...baseline,
        id: randomUUID(),
        name: 'E-seams 全片',
        fingerprint,
        createdAt: new Date().toISOString(),
        status: 'running',
        identity: {
          ...baseline.identity,
          pipelineHash: sourceHash,
          context: episodes[0]!.context,
          promptVersion: AI_PROMPT_VERSION,
          segmentationVersion: DISPLAY_SEGMENTATION_VERSION,
          windowIds: baseline.windows.map((w) => w.id),
        },
        results: {},
        entityAttempts: [],
        planningAttempts: [],
        cases: [
          ...baseline.cases,
          {
            id: 'opening',
            label: '开场问候',
            startMs: 400,
            endMs: 2560,
            review: '检查问候是否完整，不只是人名。',
          },
        ],
      };
      plans = episodes.map((episode) => ({
        episode: episode.id,
        done: false,
        windows: episode.windows,
      }));
      details = [];
      await mkdir(path.join(directory, 'requests'));
      await mkdir(path.join(directory, 'source'));
      await Promise.all(
        files.map((file) =>
          copyFile(
            new URL(file, import.meta.url),
            path.join(directory, 'source', path.basename(file)),
          ),
        ),
      );
      await writeJson(path.join(directory, 'manifest.json'), {
        version: 'full-seams-ids-v1',
        fingerprint,
        sourceHash,
        experimentHash,
        baseline: path.resolve(baselinePath),
        model: 'gemini-3.5-flash-lite',
        endpoint: 'https://api.gpt.ge/v1/chat/completions',
        outputLimits: [4096, 8192],
        initialRequestLimit: limit,
        concurrency,
        contextPolicy:
          'Fixed whole-video source evidence and previously verified aliases; no historical Chinese translations; 15s before/after source; only within-pair previous accepted cues.',
        boundaryPolicy:
          'Non-overlapping pairs of original windows; E changes each internal seam only. Singleton tail retained. Invalid plans fall back to the two original windows and are recorded.',
        expectedTokens: baseline.tokens.length,
        sourceStartMs: baseline.tokens[0]!.startMs,
        sourceEndMs: baseline.tokens.at(-1)!.endMs,
      });
    }
    run.status = 'running';
    const checkpoint = () => {
      queue = queue.then(async () => {
        run.windows = plans.flatMap((p) => p.windows);
        assertExactCoverage(baseline.tokens, run.windows);
        run.identity.windowIds = run.windows.map((w) => w.id);
        run.updatedAt = new Date().toISOString();
        await writeJson(path.join(directory, 'result.json'), run, secret);
        await writeJson(path.join(directory, 'plans.json'), plans, secret);
        await writeJson(path.join(directory, 'recovery.json'), details, secret);
      });
      return queue;
    };
    const finish = async () => {
      await checkpoint();
      await writeReport(directory);
      const stats = summarize(run);
      const latestDetails = details.filter(
        (d) => currentAttempt(run, d.windowId)?.id === d.attemptId,
      );
      const attempts = [...(run.planningAttempts ?? []), ...Object.values(run.results).flat()];
      await writeJson(path.join(directory, 'full-summary.json'), {
        ...stats,
        completedPlans: plans.filter((p) => p.done).length,
        fallbackPlans: plans
          .filter((p) => p.fallback)
          .map((p) => ({ episode: p.episode, reason: p.fallback })),
        unreviewedWindows: latestDetails
          .filter((d) => !d.result.reviewComplete)
          .map((d) => d.windowId),
        unresolvedIssues: latestDetails.flatMap((d) =>
          d.result.finalIssues.map((issue) => ({ windowId: d.windowId, ...issue })),
        ),
        structuralRecoveries: latestDetails.filter((d) => d.result.structuralRecovery).length,
        repairedCues: latestDetails.reduce((sum, d) => sum + d.result.repaired, 0),
        lengthRetries: attempts
          .flatMap((a) => a.stages)
          .filter((stage) => stage.endsWith('-length-retry')).length,
        invocationsRequestLimit: limit,
        thisInvocationRequests: budget.used,
      });
      console.info(
        JSON.stringify({
          status: run.status,
          success: stats.successfulWindows,
          partial: stats.partialWindows,
          failed: stats.failedWindows,
          pending: stats.pendingWindows,
          missing: stats.missingTokens,
          requests: stats.requestCount,
          reportedTokens: stats.reportedUsage?.total,
        }),
      );
    };
    await checkpoint();
    await runWorkers(episodes, concurrency, async (episode) => {
      if (controller.signal.aborted || budget.exhausted || budget.used >= limit) return;
      const plan = plans.find((p) => p.episode === episode.id)!;
      if (!plan.done) {
        if (episode.windows.length === 1) {
          plan.done = true;
        } else {
          const active = makeAttempt(episode.tokens);
          run.planningAttempts!.push(active);
          plan.attemptId = active.id;
          await checkpoint();
          const start = performance.now();
          try {
            const content = await jsonClient(
              directory,
              active,
              episode.id,
              secret,
              budget,
              controller,
            )(
              'plan-seam',
              seamPrompt(episode, surroundingSource(baseline.tokens, episode.tokens)),
              SEAM_SCHEMA,
            );
            plan.windows = parseSeam(content, episode).windows;
            plan.done = true;
            delete plan.fallback;
            active.status = 'success';
          } catch (error) {
            active.error = redact(String(error), secret);
            active.status =
              controller.signal.aborted || budget.exhausted ? 'interrupted' : 'failed';
            if (active.status === 'failed') {
              plan.done = true;
              plan.fallback = active.error;
              plan.windows = episode.windows;
            }
          }
          active.durationMs = Math.round(performance.now() - start);
          await checkpoint();
        }
      }
      if (!plan.done || controller.signal.aborted || budget.exhausted) return;
      const completed: DisplayCue[] = [];
      for (const window of plan.windows) {
        if (controller.signal.aborted || budget.exhausted || budget.used >= limit) break;
        const context = {
          ...episode.context,
          previousCues: completed
            .slice(-6)
            .map((c) => ({ sourceText: c.sourceText, translation: c.translation })),
        };
        const prior = currentAttempt(run, window.id);
        const priorDetail = details.find((d) => d.attemptId === prior?.id);
        if (
          prior?.status === 'success' &&
          prior.contextHash === hash(context) &&
          priorDetail?.result.reviewComplete
        ) {
          completed.push(...prior.cues);
          continue;
        }
        const active = makeAttempt(context);
        (run.results[window.id] ??= []).push(active);
        await checkpoint();
        const start = performance.now();
        try {
          const result = await translateResilient(
            window.tokens,
            context,
            surroundingSource(baseline.tokens, window.tokens),
            jsonClient(directory, active, `${episode.id}:${window.id}`, secret, budget, controller),
          );
          details.push({ attemptId: active.id, episode: episode.id, windowId: window.id, result });
          active.cues = result.cues;
          active.status = result.missing.length
            ? result.cues.length
              ? 'partial'
              : 'failed'
            : 'success';
          if (result.missing.length)
            active.error = `仍有 ${result.missing.length} 个片段没有可接受译文。`;
          active.diagnostics = result.warnings.map((message) => ({ kind: 'fallback', message }));
          completed.push(...result.cues);
        } catch (error) {
          active.status = controller.signal.aborted || budget.exhausted ? 'interrupted' : 'failed';
          active.error = redact(String(error), secret);
        }
        active.durationMs = Math.round(performance.now() - start);
        await checkpoint();
        const count = run.windows.filter(
          (w) => currentAttempt(run, w.id)?.status === 'success',
        ).length;
        console.info(
          `${episode.id} · ${Math.round(window.startMs / 1000)}—${Math.round(window.endMs / 1000)}s · ${active.status} · ${active.requests.length} 请求 · 完整 ${count}/${run.windows.length}`,
        );
      }
    });
    run.status =
      controller.signal.aborted ||
      budget.exhausted ||
      run.windows.some(
        (w) =>
          !currentAttempt(run, w.id) ||
          ['running', 'interrupted'].includes(currentAttempt(run, w.id)!.status),
      )
        ? 'paused'
        : run.windows.every((w) => currentAttempt(run, w.id)?.status === 'success')
          ? 'completed'
          : 'completed-with-errors';
    await finish();
    // Count traces too: abrupt termination can leave a recorded request newer than an earlier checkpoint.
    console.info(
      `报告：${path.join(directory, 'report.html')} · 已保存 ${(await readdir(path.join(directory, 'requests'))).filter((file) => file.endsWith('.json')).length} 条请求记录`,
    );
    if (run.status !== 'completed') process.exitCode = 2;
  } finally {
    try {
      await queue;
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      await unlock();
    }
  }
}
main().catch((error: unknown) => {
  console.error(redact(String(error), secret));
  process.exitCode = 1;
});
