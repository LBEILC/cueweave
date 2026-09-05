import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { DisplayCue, TokenWindow } from '@cueweave/core/subtitle';
import {
  FIRST_PASS_VERSION,
  translateFirstPass,
  type FirstPassResult,
} from '@cueweave/core/provider/firstPass';
import { acquireLock, hash, pipelineHash, readRun, redact, writeJson } from './eval/io';
import { summarize } from './eval/analysis';
import { contextForWindow } from './eval/runner';
import { jsonClient } from './eval/json-client';
import { parseSeam, seamPrompt, SEAM_SCHEMA } from './eval/seam-planner';
import { assertExactCoverage, surroundingSource, type Episode } from './eval/window-experiment';
import { writeReport, writeComparison } from './eval/report';
import { currentAttempt, type Attempt, type EvalRun } from './eval/types';
import type { RequestBudget } from './eval/trace';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    'token-file': { type: 'string' },
    windows: { type: 'string' },
    'max-requests': { type: 'string', default: '450' },
    resume: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
const attempt = (context: object): Attempt => ({
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
interface State {
  nextIndex: number;
  pending: TokenWindow;
  committed: TokenWindow[];
  steps: Array<{ beforeMs: number; afterMs: number; reason?: string; fallback?: string }>;
  details: Array<{
    windowId: string;
    attemptId: string;
    result: FirstPassResult;
    readyAtMs: number;
    startedAtMs: number;
  }>;
  elapsedMs: number;
}
let secret = '';
async function main() {
  if (values.help) {
    console.info(
      '连续首轮评测\nnode --import tsx scripts/experiment-first-pass.ts --out <目录> --token-file <密钥文件> [--windows <前 N 窗>] [--max-requests 450] [--resume] [--dry-run]\n使用 gpt.ge 的 Gemini 3.5 Flash Lite。连续滚动规划与上一窗翻译重叠执行，最多两个在途请求。正常翻译无额外模型复核，异常才恢复。耗时是离线队列实测，不代表浏览器播放验证。',
    );
    return;
  }
  if (!values.out) throw new Error('缺少 --out。运行 --help 查看用法。');
  const limit = Number(values['max-requests']),
    count = values.windows ? Number(values.windows) : undefined;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    (count !== undefined && (!Number.isSafeInteger(count) || count < 1))
  )
    throw new Error('请求上限和窗口数必须为正整数。');
  const baseline = await readRun('.eval/runs/compare-gemini-3.5-flash-lite');
  const original = count === undefined ? baseline.windows : baseline.windows.slice(0, count);
  const selected = original.flatMap((w) => w.tokens);
  assertExactCoverage(selected, original);
  const context = contextForWindow({ ...baseline, windows: [], results: {} }, 0);
  const directory = path.resolve(values.out),
    sourceHash = await pipelineHash();
  const files = [
    'scripts/experiment-first-pass.ts',
    'packages/core/src/provider/firstPass.ts',
    'packages/core/src/provider/completeOutput.ts',
    'packages/core/src/domain/subtitle/ai.ts',
    'scripts/eval/seam-planner.ts',
    'scripts/eval/window-experiment.ts',
    'scripts/eval/json-client.ts',
    'scripts/eval/complete-output.ts',
  ];
  const experimentHash = hash(
    await Promise.all(files.map(async (f) => [f, await readFile(f, 'utf8')])),
  );
  const fingerprint = hash([selected, context, sourceHash, experimentHash]);
  console.info(`连续首轮 · ${original.length} 窗 · ${selected.length} 词元 · 请求上限 ${limit}`);
  if (values['dry-run']) {
    console.info('原文覆盖检查通过；未读取密钥、写入目录或调用模型。');
    return;
  }
  if (!values['token-file']) throw new Error('缺少 --token-file。');
  secret = (await readFile(values['token-file'], 'utf8')).trim();
  if (!secret) throw new Error('密钥文件为空。');
  if (!values.resume) {
    await mkdir(path.dirname(directory), { recursive: true });
    await mkdir(directory);
  }
  const unlock = await acquireLock(directory),
    controller = new AbortController(),
    budget: RequestBudget = { used: 0, limit, exhausted: false };
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let saveQueue = Promise.resolve(),
    translation = Promise.resolve();
  const begin = performance.now();
  try {
    let run: EvalRun, state: State;
    if (values.resume) {
      run = await readRun(directory);
      if (run.fingerprint !== fingerprint)
        throw new Error('源码、输入或上下文改变，不能续跑；请使用新目录。');
      state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
    } else {
      run = {
        ...baseline,
        id: randomUUID(),
        name: 'I-first-pass · 连续首轮',
        fingerprint,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'running',
        windows: original,
        identity: {
          ...baseline.identity,
          pipelineHash: sourceHash,
          promptVersion: FIRST_PASS_VERSION,
          context,
          windowIds: original.map((w) => w.id),
        },
        results: {},
        entityAttempts: [],
        planningAttempts: [],
      };
      state = {
        nextIndex: 1,
        pending: original[0]!,
        committed: [],
        steps: [],
        details: [],
        elapsedMs: 0,
      };
      await mkdir(path.join(directory, 'requests'));
      await mkdir(path.join(directory, 'source'));
      await Promise.all(
        files.map((f) => copyFile(f, path.join(directory, 'source', path.basename(f)))),
      );
      await writeJson(path.join(directory, 'manifest.json'), {
        fingerprint,
        sourceHash,
        experimentHash,
        version: FIRST_PASS_VERSION,
        model: baseline.identity.model,
        endpoint: 'https://api.gpt.ge/v1/chat/completions',
        expectedTokens: selected.length,
        windows: original.length,
        requestLimit: limit,
        concurrency: 2,
        policy:
          'Continuous rolling source windows. One planner and one translator can overlap. Previous six accepted cues only, fixed video evidence and aliases, 15s source neighbors. No routine semantic review or post-display repair. Window results are published once after bounded exception recovery.',
      });
    }
    const priorElapsed = state.elapsedMs;
    const elapsed = () => priorElapsed + Math.round(performance.now() - begin);
    const stopped = () => controller.signal.aborted || budget.exhausted || budget.used >= limit;
    const save = () => {
      saveQueue = saveQueue.then(async () => {
        run.windows = [...state.committed, state.pending, ...original.slice(state.nextIndex)];
        assertExactCoverage(selected, run.windows);
        run.identity.windowIds = run.windows.map((w) => w.id);
        run.updatedAt = new Date().toISOString();
        state.elapsedMs = elapsed();
        await writeJson(path.join(directory, 'result.json'), run, secret);
        await writeJson(path.join(directory, 'state.json'), state, secret);
      });
      return saveQueue;
    };
    const completed: DisplayCue[] = [];
    const translate = async (window: TokenWindow) => {
      if (stopped()) return;
      const currentContext = {
        ...context,
        previousCues: completed
          .slice(-6)
          .map((c) => ({ sourceText: c.sourceText, translation: c.translation })),
      };
      const prior = currentAttempt(run, window.id);
      if (prior?.status === 'success' && prior.contextHash === hash(currentContext)) {
        completed.push(...prior.cues);
        return;
      }
      const active = attempt(currentContext),
        startedAtMs = elapsed();
      (run.results[window.id] ??= []).push(active);
      await save();
      try {
        const result = await translateFirstPass(
          window.tokens,
          currentContext,
          surroundingSource(baseline.tokens, window.tokens),
          jsonClient(directory, active, window.id, secret, budget, controller),
        );
        active.cues = result.cues;
        active.status = result.missingTokenIds.length
          ? result.cues.length
            ? 'partial'
            : 'failed'
          : 'success';
        active.diagnostics = result.diagnostics.map((message) => ({ kind: 'fallback', message }));
        state.details.push({
          windowId: window.id,
          attemptId: active.id,
          result,
          startedAtMs,
          readyAtMs: elapsed(),
        });
        completed.push(...result.cues);
      } catch (error) {
        active.status = stopped() ? 'interrupted' : 'failed';
        active.error = redact(String(error), secret);
      }
      active.durationMs = elapsed() - startedAtMs;
      await save();
      console.info(
        `${Math.round(window.startMs / 1000)}—${Math.round(window.endMs / 1000)}s · ${active.status} · ${active.requests.length} 请求 · ${active.durationMs}ms`,
      );
    };
    run.status = 'running';
    await save();
    for (const window of state.committed) await translate(window);
    for (; state.nextIndex < original.length && !stopped();) {
      const next = original[state.nextIndex]!;
      const pair: Episode = {
        id: `seam-${state.nextIndex}`,
        windows: [state.pending, next],
        tokens: [...state.pending.tokens, ...next.tokens],
        context,
        review: {
          id: 'continuous',
          label: '连续规划',
          startMs: state.pending.startMs,
          endMs: next.endMs,
          review: '',
        },
      };
      const active = attempt(pair.tokens);
      run.planningAttempts!.push(active);
      await save();
      const started = performance.now();
      let planned = pair.windows,
        reason: string | undefined,
        fallback: string | undefined;
      try {
        const parsed = parseSeam(
          await jsonClient(
            directory,
            active,
            pair.id,
            secret,
            budget,
            controller,
          )(
            'rolling-seam',
            seamPrompt(pair, surroundingSource(baseline.tokens, pair.tokens)),
            SEAM_SCHEMA,
          ),
          pair,
        );
        planned = parsed.windows;
        reason = parsed.reasons[0];
        active.status = 'success';
      } catch (error) {
        fallback = redact(String(error), secret);
        active.error = fallback;
        active.status = stopped() ? 'interrupted' : 'failed';
      }
      active.durationMs = Math.round(performance.now() - started);
      if (stopped()) {
        await save();
        break;
      }
      state.steps.push({
        beforeMs: state.pending.endMs,
        afterMs: planned[0]!.endMs,
        ...(reason ? { reason } : {}),
        ...(fallback ? { fallback } : {}),
      });
      state.committed.push(planned[0]!);
      state.pending = planned[1]!;
      state.nextIndex++;
      await save();
      await translation;
      translation = translate(planned[0]!);
    }
    await translation;
    if (!stopped()) await translate(state.pending);
    run.status = stopped()
      ? 'paused'
      : [...state.committed, state.pending].every(
            (w) => currentAttempt(run, w.id)?.status === 'success',
          )
        ? 'completed'
        : 'completed-with-errors';
    await save();
    await writeReport(directory);
    const latest = state.details.filter((d) => currentAttempt(run, d.windowId)?.id === d.attemptId);
    const latency = latest
      .map((d) => currentAttempt(run, d.windowId)!.durationMs)
      .sort((a, b) => a - b);
    const first = latest[0];
    // Offline start-at-zero simulation: playback begins only after the first window is ready.
    const late = first
      ? latest.filter(
          (d) =>
            d.readyAtMs >
            first.readyAtMs +
              (run.windows.find((w) => w.id === d.windowId)!.startMs - run.windows[0]!.startMs),
        )
      : [];
    const comparison = path.join(directory, `E-vs-I-${run.updatedAt.replace(/[:.]/gu, '-')}`);
    const summary = {
      ...summarize(run),
      elapsedMs: state.elapsedMs,
      firstReadyMs: first?.readyAtMs ?? null,
      windowLatencyP50: latency[Math.floor(latency.length * 0.5)] ?? null,
      windowLatencyP95:
        latency[Math.min(latency.length - 1, Math.floor(latency.length * 0.95))] ?? null,
      firstPassCompleteWindows: latest.filter((d) => d.result.firstPassComplete).length,
      recoveryCalls: latest.reduce((sum, d) => sum + d.result.recoveryCalls, 0),
      planningFallbacks: state.steps.filter((s) => s.fallback),
      steadyPlaybackLateWindows: late.map((d) => d.windowId),
      latencyScope: 'Offline wall-clock queue; not a browser playback or seek measurement',
      thisInvocationRequests: budget.used,
      comparisonReport: path.join(comparison, 'report.html'),
    };
    await writeJson(path.join(directory, 'first-pass-summary.json'), summary);
    await writeComparison('.eval/runs/full-e-seams-20260903', directory, comparison);
    console.info(JSON.stringify(summary));
    if (run.status !== 'completed') process.exitCode = 2;
  } finally {
    await translation;
    await saveQueue;
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await unlock();
  }
}
main().catch((error: unknown) => {
  console.error(redact(String(error), secret));
  process.exitCode = 1;
});
