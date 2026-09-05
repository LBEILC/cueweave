import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { DisplayCue, TokenWindow } from '@cueweave/core/subtitle';
import { AI_PROMPT_VERSION, DISPLAY_SEGMENTATION_VERSION } from '@cueweave/core/subtitle/ai';
import { acquireLock, hash, pipelineHash, readRun, redact, writeJson } from './eval/io';
import { summarize } from './eval/analysis';
import { contextForWindow } from './eval/runner';
import { jsonClient } from './eval/json-client';
import { planRollingSeams } from './eval/rolling-seams';
import { repairDisplayBoundaries } from './eval/boundary-repair';
import { translateResilient } from './eval/resilient-translation';
import { assertExactCoverage, surroundingSource, type Episode } from './eval/window-experiment';
import { writeComparison, writeReport } from './eval/report';
import { currentAttempt, type Attempt, type EvalRun } from './eval/types';
import type { RequestBudget } from './eval/trace';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    'token-file': { type: 'string' },
    'max-requests': { type: 'string', default: '200' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
const CASES = [
  {
    id: 'opening',
    index: 0,
    startMs: 400,
    endMs: 32800,
    label: '完整问候与目的关系',
    review: '问候完整；confidently 与继续训练关联。',
  },
  {
    id: 'talking',
    index: 4,
    startMs: 172959,
    endMs: 179280,
    label: '动词搭配',
    review: 'talking about 不应分成两条残片，也不应重复翻译。',
  },
  {
    id: 'parallel',
    index: 52,
    startMs: 1529000,
    endMs: 1547000,
    label: '长句并列场景对照',
    review: '工作、新任务、个人生活的并列场景完整且自然分屏。',
  },
  {
    id: 'little',
    index: 102,
    startMs: 2937760,
    endMs: 2943200,
    label: '程度搭配',
    review: 'a little bit 不割裂、不重复。',
  },
  {
    id: 'comparative',
    index: 120,
    startMs: 3430000,
    endMs: 3453000,
    label: '比较结构',
    review: '保留潜力与推迟 IPO 的比较关联；不闪现孤立承接残片。',
  },
];
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
      '滚动接缝与局部重分段实验\nnode --import tsx scripts/experiment-rolling.ts --out <新目录> --token-file <密钥文件> [--max-requests 200] [--dry-run]\nE-fixed 复用记录的 E 边界并重新翻译；F-rolling 滚动规划后重新翻译；G-repaired 复用 F 译文，只追加局部边界复核与修复。使用 gpt.ge 的 Gemini 3.5 Flash Lite；请求上限包含三档的全部新增请求。此命令不支持续跑，记录逐窗检查点与独立请求日志。',
    );
    return;
  }
  if (!values.out) throw new Error('缺少 --out。运行 --help 查看用法。');
  const limit = Number(values['max-requests']);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('--max-requests 必须为正整数。');
  const baselinePath = '.eval/runs/compare-gemini-3.5-flash-lite',
    savedPath = '.eval/runs/full-e-seams-20260903';
  const baseline = await readRun(baselinePath),
    saved = await readRun(savedPath);
  if (
    baseline.videoId !== 'VeizK1M7V7E' ||
    baseline.identity.model !== 'gemini-3.5-flash-lite' ||
    hash(baseline.tokens) !== hash(saved.tokens)
  )
    throw new Error('基线视频、模型或原文词元不一致。');
  const context = contextForWindow({ ...baseline, windows: [], results: {} }, 0);
  const episodes: Episode[] = CASES.map((item) => {
    const windows = baseline.windows.slice(item.index, item.index + 4);
    if (windows.length !== 4) throw new Error(`片段 ${item.id} 缺少原始窗口。`);
    return {
      id: item.id,
      windows,
      tokens: windows.flatMap((w) => w.tokens),
      context,
      review: item,
    };
  });
  const fixed = episodes.map((ep) =>
    saved.windows.filter(
      (w) => w.startMs >= ep.tokens[0]!.startMs && w.endMs <= ep.tokens.at(-1)!.endMs,
    ),
  );
  episodes.forEach((ep, i) => assertExactCoverage(ep.tokens, fixed[i]!));
  const expected = episodes.flatMap((ep) => ep.tokens);
  console.info(
    `5 个片段 · ${expected.length} 词元 · E/F 各 20 窗 · G 追加局部修复 · 上限 ${limit} 次新请求`,
  );
  if (values['dry-run']) {
    console.info('输入覆盖检查通过；未读取密钥、写入目录或调用模型。');
    return;
  }
  if (!values['token-file']) throw new Error('缺少 --token-file。');
  secret = (await readFile(values['token-file'], 'utf8')).trim();
  if (!secret) throw new Error('密钥文件为空。');
  const root = path.resolve(values.out);
  await mkdir(path.dirname(root), { recursive: true });
  await mkdir(root);
  const unlock = await acquireLock(root),
    controller = new AbortController();
  const budget: RequestBudget = { used: 0, limit, exhausted: false };
  const interrupted = () => controller.abort();
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);
  const begin = performance.now();
  try {
    const sourceHash = await pipelineHash();
    const files = [
      'experiment-rolling.ts',
      'eval/rolling-seams.ts',
      'eval/boundary-repair.ts',
      'eval/resilient-translation.ts',
      'eval/seam-planner.ts',
      'eval/window-experiment.ts',
      'eval/json-client.ts',
      'eval/complete-output.ts',
    ];
    const experimentHash = hash(
      await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8'))),
    );
    const manifest = {
      createdAt: new Date().toISOString(),
      sourceHash,
      experimentHash,
      baselinePath: path.resolve(baselinePath),
      savedPath: path.resolve(savedPath),
      model: 'gemini-3.5-flash-lite',
      endpoint: 'https://api.gpt.ge/v1/chat/completions',
      requestLimit: limit,
      cases: CASES,
      contextPolicy:
        'Identical fixed original evidence and confirmed aliases; 15s neighboring source; previous six accepted cues within each four-window clip; no historical Chinese answers. Case labels are never sent.',
      definitions: {
        E: 'Recorded E window boundaries, fresh translation and semantic review; historical planning cost excluded.',
        F: 'Rolling adjacent-window planning with provisional tail; same fresh translation pipeline and context policy as E.',
        G: 'Reuse F outputs; independently audit and resegment local continuous spans. Report requests are incremental, excluding inherited F cost. Each report window is one four-window clip output span, not an API translation window.',
      },
    };
    await writeJson(path.join(root, 'manifest.json'), manifest);
    await mkdir(path.join(root, 'source'));
    await Promise.all(
      files.map((file) =>
        copyFile(new URL(file, import.meta.url), path.join(root, 'source', path.basename(file))),
      ),
    );
    function fresh(name: string, windows: TokenWindow[]): EvalRun {
      return {
        ...baseline,
        id: randomUUID(),
        name,
        fingerprint: hash([manifest, name]),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'running',
        identity: {
          ...baseline.identity,
          context,
          pipelineHash: sourceHash,
          promptVersion: AI_PROMPT_VERSION,
          segmentationVersion: DISPLAY_SEGMENTATION_VERSION,
          windowIds: windows.map((w) => w.id),
        },
        windows,
        results: {},
        entityAttempts: [],
        planningAttempts: [],
        cases: CASES,
      };
    }
    function stopped() {
      return controller.signal.aborted || budget.exhausted || budget.used >= budget.limit;
    }
    async function runArm(name: 'E-fixed' | 'F-rolling') {
      const directory = path.join(root, name);
      await mkdir(path.join(directory, 'requests'), { recursive: true });
      const plans = episodes.map((ep, i) => ({
        episode: ep.id,
        windows: name === 'E-fixed' ? fixed[i]! : ep.windows,
        steps: [] as Awaited<ReturnType<typeof planRollingSeams>>['steps'],
      }));
      const run = fresh(
        name,
        plans.flatMap((p) => p.windows),
      );
      const details: Array<{
        episode: string;
        windowId: string;
        result: Awaited<ReturnType<typeof translateResilient>>;
      }> = [];
      const checkpoint = async () => {
        run.windows = plans.flatMap((p) => p.windows);
        assertExactCoverage(expected, run.windows);
        run.identity.windowIds = run.windows.map((w) => w.id);
        run.updatedAt = new Date().toISOString();
        await writeJson(path.join(directory, 'result.json'), run, secret);
        await writeJson(path.join(directory, 'plans.json'), plans, secret);
        await writeJson(path.join(directory, 'recovery.json'), details, secret);
      };
      await checkpoint();
      for (const [i, ep] of episodes.entries()) {
        if (stopped()) break;
        const plan = plans[i]!;
        if (name === 'F-rolling') {
          const active = makeAttempt(ep.tokens);
          run.planningAttempts!.push(active);
          await checkpoint();
          const start = performance.now();
          const result = await planRollingSeams(
            ep,
            baseline.tokens,
            jsonClient(directory, active, ep.id, secret, budget, controller),
            async (windows, steps) => {
              plan.windows = windows;
              plan.steps = [...steps];
              await checkpoint();
            },
          );
          plan.windows = result.windows;
          plan.steps = result.steps;
          active.status = result.steps.some((s) => s.fallback) ? 'failed' : 'success';
          active.durationMs = Math.round(performance.now() - start);
          await checkpoint();
        }
        const completed: DisplayCue[] = [];
        for (const window of plan.windows) {
          if (stopped()) break;
          const localContext = {
            ...context,
            previousCues: completed
              .slice(-6)
              .map((c) => ({ sourceText: c.sourceText, translation: c.translation })),
          };
          const active = makeAttempt(localContext);
          run.results[window.id] = [active];
          await checkpoint();
          const start = performance.now();
          try {
            const result = await translateResilient(
              window.tokens,
              localContext,
              surroundingSource(baseline.tokens, window.tokens),
              jsonClient(directory, active, `${ep.id}:${window.id}`, secret, budget, controller),
            );
            details.push({ episode: ep.id, windowId: window.id, result });
            active.cues = result.cues;
            active.status = !result.missing.length
              ? 'success'
              : result.cues.length
                ? 'partial'
                : 'failed';
            active.diagnostics = result.warnings.map((message) => ({ kind: 'fallback', message }));
            completed.push(...result.cues);
          } catch (error) {
            active.status = stopped() ? 'interrupted' : 'failed';
            active.error = redact(String(error), secret);
          }
          active.durationMs = Math.round(performance.now() - start);
          await checkpoint();
          console.info(
            `${name} · ${ep.id} · ${Math.round(window.startMs / 1000)}s · ${active.status} · ${active.requests.length} 请求`,
          );
        }
      }
      run.status = stopped()
        ? 'paused'
        : run.windows.every((w) => currentAttempt(run, w.id)?.status === 'success')
          ? 'completed'
          : 'completed-with-errors';
      await checkpoint();
      await writeReport(directory);
      return { run, plans, details };
    }
    const settled = await Promise.allSettled([runArm('E-fixed'), runArm('F-rolling')]);
    const e = settled[0]?.status === 'fulfilled' ? settled[0].value : undefined;
    const f = settled[1]?.status === 'fulfilled' ? settled[1].value : undefined;
    const errors = settled.flatMap((s) =>
      s.status === 'rejected' ? [redact(String(s.reason), secret)] : [],
    );
    let g: EvalRun | undefined;
    const repairs: Array<{
      episode: string;
      result: Awaited<ReturnType<typeof repairDisplayBoundaries>>;
    }> = [];
    if (f) {
      const directory = path.join(root, 'G-repaired');
      await mkdir(path.join(directory, 'requests'), { recursive: true });
      const windows = episodes.map((ep) => ({
        id: `span:${ep.id}`,
        startMs: ep.tokens[0]!.startMs,
        endMs: ep.tokens.at(-1)!.endMs,
        tokens: ep.tokens,
      }));
      g = fresh('G-repaired · F 派生局部修复', windows);
      for (const [i, ep] of episodes.entries()) {
        const cues = f.plans[i]!.windows.flatMap((w) => currentAttempt(f.run, w.id)?.cues ?? []);
        const a = makeAttempt(context);
        a.cues = cues;
        a.status =
          cues.flatMap((c) => c.sourceTokenIds).length === ep.tokens.length
            ? 'success'
            : cues.length
              ? 'partial'
              : 'failed';
        g.results[windows[i]!.id] = [a];
      }
      const checkpoint = async () => {
        g!.updatedAt = new Date().toISOString();
        await writeJson(path.join(directory, 'result.json'), g, secret);
        await writeJson(path.join(directory, 'repairs.json'), repairs, secret);
      };
      await writeJson(path.join(directory, 'derivation.json'), {
        from: '../F-rolling',
        fingerprint: f.run.fingerprint,
        costPolicy: 'Only new boundary-review/resegment/verify calls; F generation cost excluded.',
      });
      await checkpoint();
      for (const [i, ep] of episodes.entries()) {
        if (stopped()) break;
        const active = currentAttempt(g, windows[i]!.id)!;
        const start = performance.now();
        const result = await repairDisplayBoundaries(
          active.cues,
          baseline.tokens,
          context,
          f.plans[i]!.windows.slice(0, -1).map((w) => w.endMs),
          jsonClient(directory, active, ep.id, secret, budget, controller),
        );
        active.cues = result.cues;
        active.durationMs = Math.round(performance.now() - start);
        active.diagnostics = result.warnings.map((message) => ({ kind: 'fallback', message }));
        repairs.push({ episode: ep.id, result });
        await checkpoint();
        console.info(
          `G-repaired · ${ep.id} · 应用 ${result.repairs.filter((r) => r.status === 'applied').length}/${result.repairs.length} · ${active.requests.length} 新请求`,
        );
      }
      g.status =
        repairs.length < episodes.length
          ? 'paused'
          : g.windows.every((w) => currentAttempt(g!, w.id)?.status === 'success')
            ? 'completed'
            : 'completed-with-errors';
      await checkpoint();
      await writeReport(directory);
    }
    if (e && f)
      await writeComparison(
        path.join(root, 'E-fixed'),
        path.join(root, 'F-rolling'),
        path.join(root, 'E-vs-F'),
      );
    if (f && g)
      await writeComparison(
        path.join(root, 'F-rolling'),
        path.join(root, 'G-repaired'),
        path.join(root, 'F-vs-G'),
      );
    const summary = {
      wallMs: Math.round(performance.now() - begin),
      requests: budget.used,
      errors,
      E: e && summarize(e.run),
      F: f && summarize(f.run),
      G_incremental: g && summarize(g),
      planningFallbacks: f?.plans.flatMap((p) => p.steps.filter((s) => s.fallback)),
      unreviewed: {
        E: e?.details.filter((d) => !d.result.reviewComplete).map((d) => d.windowId),
        F: f?.details.filter((d) => !d.result.reviewComplete).map((d) => d.windowId),
        G: repairs.filter((d) => !d.result.reviewComplete).map((d) => d.episode),
      },
      applied: repairs.flatMap((r) => r.result.repairs).filter((r) => r.status === 'applied')
        .length,
      retained: repairs.flatMap((r) => r.result.repairs).filter((r) => r.status === 'retained')
        .length,
    };
    await writeJson(path.join(root, 'summary.json'), summary, secret);
    console.info(
      JSON.stringify({
        root,
        requests: budget.used,
        errors,
        missing: [
          summary.E?.missingTokens,
          summary.F?.missingTokens,
          summary.G_incremental?.missingTokens,
        ],
        applied: summary.applied,
        retained: summary.retained,
      }),
    );
    if (errors.length || stopped()) process.exitCode = 1;
  } finally {
    process.off('SIGINT', interrupted);
    process.off('SIGTERM', interrupted);
    await unlock();
  }
}
main().catch((error) => {
  console.error(redact(String(error), secret));
  process.exitCode = 1;
});
