import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { TokenWindow } from '@cueweave/core/subtitle';
import { acquireLock, hash, pipelineHash, readRun, redact, writeJson } from './eval/io';
import { currentAttempt, type Attempt, type EvalRun } from './eval/types';
import { summarize } from './eval/analysis';
import { repairDisplayBoundaries } from './eval/boundary-repair';
import { jsonClient } from './eval/json-client';
import { writeComparison, writeReport } from './eval/report';
import type { RequestBudget } from './eval/trace';

const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    out: { type: 'string' },
    'token-file': { type: 'string' },
    'max-requests': { type: 'string', default: '50' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
let secret = '';
async function main() {
  if (values.help) {
    console.info(
      '局部边界回放\nnode --import tsx scripts/replay-boundaries.ts --from <滚动实验 F 目录> --out <新目录> --token-file <密钥文件> [--max-requests 50] [--dry-run]\n复用保存的译文，只计新增边界复核、重分段和验收请求。使用 gpt.ge 的 Gemini 3.5 Flash Lite。要求 plans.json，不支持续跑。',
    );
    return;
  }
  if (!values.from || !values.out) throw new Error('缺少 --from 或 --out。运行 --help 查看用法。');
  const baseline = await readRun(values.from);
  const plans = JSON.parse(await readFile(path.join(values.from, 'plans.json'), 'utf8')) as Array<{
    episode: string;
    windows: TokenWindow[];
  }>;
  if (
    baseline.identity.model !== 'gemini-3.5-flash-lite' ||
    !Array.isArray(plans) ||
    !plans.length ||
    hash(plans.flatMap((p) => p.windows)) !== hash(baseline.windows)
  )
    throw new Error('回放要求匹配的 Gemini 3.5 运行和规划记录。');
  const limit = Number(values['max-requests']);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('请求上限必须为正整数。');
  console.info(`复用 ${plans.length} 个片段的译文 · 最多 ${limit} 次新请求`);
  if (values['dry-run']) {
    console.info('检查通过，未读取密钥或写入输出。');
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
    await mkdir(path.join(root, 'requests'));
    await mkdir(path.join(root, 'source'));
    const files = [
      'replay-boundaries.ts',
      'eval/boundary-repair.ts',
      'eval/resilient-translation.ts',
      'eval/json-client.ts',
      'eval/complete-output.ts',
      'eval/window-experiment.ts',
    ];
    const sourceHash = await pipelineHash(),
      experimentHash = hash(
        await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8'))),
      );
    await Promise.all(
      files.map((file) =>
        copyFile(new URL(file, import.meta.url), path.join(root, 'source', path.basename(file))),
      ),
    );
    const manifest = {
      from: path.resolve(values.from),
      sourceFingerprint: baseline.fingerprint,
      sourceHash,
      experimentHash,
      model: 'gemini-3.5-flash-lite',
      endpoint: 'https://api.gpt.ge/v1/chat/completions',
      requestLimit: limit,
      costPolicy: 'Incremental requests only; inherited translation/planning cost excluded.',
      windowsPolicy:
        'One output span per four-window source clip; not new translation API windows.',
    };
    await writeJson(path.join(root, 'manifest.json'), manifest);
    const windows = plans.map((p) => {
      const tokens = p.windows.flatMap((w) => w.tokens);
      return {
        id: `span:${p.episode}`,
        startMs: tokens[0]!.startMs,
        endMs: tokens.at(-1)!.endMs,
        tokens,
      };
    });
    const run: EvalRun = {
      ...baseline,
      id: randomUUID(),
      name: 'G2-guarded · 局部分段收益复核',
      fingerprint: hash(manifest),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      identity: {
        ...baseline.identity,
        pipelineHash: sourceHash,
        windowIds: windows.map((w) => w.id),
      },
      windows,
      results: {},
      entityAttempts: [],
      planningAttempts: [],
    };
    for (const [i, p] of plans.entries()) {
      const cues = p.windows.flatMap((w) => currentAttempt(baseline, w.id)?.cues ?? []);
      const complete =
        hash(cues.flatMap((c) => c.sourceTokenIds)) === hash(windows[i]!.tokens.map((t) => t.id));
      const active: Attempt = {
        id: randomUUID(),
        contextHash: hash(baseline.identity.context),
        status: complete ? 'success' : cues.length ? 'partial' : 'failed',
        startedAt: new Date().toISOString(),
        durationMs: 0,
        stages: [],
        diagnostics: [],
        requests: [],
        cues,
      };
      run.results[windows[i]!.id] = [active];
    }
    const details: Array<{
      episode: string;
      result: Awaited<ReturnType<typeof repairDisplayBoundaries>>;
    }> = [];
    const checkpoint = async () => {
      run.updatedAt = new Date().toISOString();
      await writeJson(path.join(root, 'result.json'), run, secret);
      await writeJson(path.join(root, 'repairs.json'), details, secret);
    };
    await checkpoint();
    for (const [i, p] of plans.entries()) {
      if (budget.used >= limit || budget.exhausted || controller.signal.aborted) break;
      const active = currentAttempt(run, windows[i]!.id)!;
      const start = performance.now();
      const result = await repairDisplayBoundaries(
        active.cues,
        baseline.tokens,
        baseline.identity.context,
        p.windows.slice(0, -1).map((w) => w.endMs),
        jsonClient(root, active, p.episode, secret, budget, controller),
      );
      active.cues = result.cues;
      active.durationMs = Math.round(performance.now() - start);
      active.diagnostics = result.warnings.map((message) => ({ kind: 'fallback', message }));
      details.push({ episode: p.episode, result });
      await checkpoint();
      console.info(
        `${p.episode} · 应用 ${result.repairs.filter((r) => r.status === 'applied').length}/${result.repairs.length} · ${active.requests.length} 新请求`,
      );
    }
    run.status =
      controller.signal.aborted || budget.exhausted || details.length < plans.length
        ? 'paused'
        : run.windows.every((w) => currentAttempt(run, w.id)?.status === 'success')
          ? 'completed'
          : 'completed-with-errors';
    await checkpoint();
    await writeReport(root);
    await writeJson(path.join(root, 'summary.json'), {
      ...summarize(run),
      wallMs: Math.round(performance.now() - begin),
      applied: details.flatMap((d) => d.result.repairs).filter((r) => r.status === 'applied')
        .length,
      retained: details.flatMap((d) => d.result.repairs).filter((r) => r.status === 'retained')
        .length,
      unreviewed: details.filter((d) => !d.result.reviewComplete).map((d) => d.episode),
      untouched: plans.slice(details.length).map((p) => p.episode),
    });
    await writeComparison(values.from, root, path.join(root, 'F-vs-G2'));
    console.info(`回放完成：${root} · ${budget.used} 次新请求`);
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
