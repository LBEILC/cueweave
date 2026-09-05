import { randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { DisplayCue, SourceToken, TranslationTerm } from '@cueweave/core/subtitle';
import type { AiSubtitleContext } from '@cueweave/core/subtitle/ai';
import {
  createSubtitleJsonRequest,
  translatePlaybackWindow,
  PartialTranslationError,
} from '@cueweave/core/provider/chatCompletions';
import {
  TRANSLATION_POLICY_VERSION,
  type TranslationMode,
} from '@cueweave/core/provider/translationPolicy';
import { PlaybackPlan, sourceNeighbors } from '@cueweave/core/provider/playbackPlan';
import { DEFAULT_PROVIDER_SETTINGS } from '@cueweave/core/provider/settings';
import type { ProviderSettings } from '@cueweave/core/provider/types';
import { acquireLock, hash, pipelineHash, PROJECT_ROOT, redact, writeJson } from './eval/io';
import { createRuntime, type RequestBudget } from './eval/trace';
import type { Attempt } from './eval/types';

interface DatasetEntry {
  id: string;
  split: string;
  tier: string;
  smoke: boolean;
  input: string;
  sha256: string;
}
interface Input {
  videoId: string;
  timing: string;
  tokens: SourceToken[];
  scoreTokenIds: string[];
  context: AiSubtitleContext;
}
interface CaseResult {
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: string;
  durationMs: number;
  firstUsableMs?: number;
  inputSha256: string;
  attempts: Attempt[];
  plan: ReturnType<PlaybackPlan['snapshot']>;
  planningFallbacks: string[];
  cues: DisplayCue[];
  missingScoreTokens: string[];
  missingInputTokens: string[];
  duplicatedInputTokens: string[];
  unexpectedInputTokens: string[];
  error?: string;
}
interface Run {
  schema: 1;
  fingerprint: string;
  identity: object;
  selected: DatasetEntry[];
  results: Record<string, CaseResult[]>;
  status: 'running' | 'completed' | 'paused' | 'completed-with-errors';
}

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    dataset: { type: 'string', default: '.fixtures/translation-benchmark/v1' },
    group: { type: 'string', default: 'smoke' },
    mode: { type: 'string', default: 'balanced' },
    model: { type: 'string' },
    'base-url': { type: 'string' },
    protocol: { type: 'string' },
    'token-file': { type: 'string' },
    'max-requests': { type: 'string', default: '150' },
    resume: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
let secret = '';

async function main(): Promise<void> {
  if (values.help) {
    console.log(
      'Production first-pass benchmark (no reference/judge input).\n--out .eval/benchmarks/<new-directory> --group smoke|development|holdout|diagnostic|all --token-file <file> [--mode speed|balanced] [--model id] [--base-url url] [--protocol auto|chat-completions|responses] [--max-requests 150] [--resume] [--dry-run]',
    );
    return;
  }
  const groups = ['smoke', 'development', 'holdout', 'diagnostic', 'all'];
  if (!groups.includes(values.group)) throw new Error('未知测试集分组');
  if (!['speed', 'balanced'].includes(values.mode))
    throw new Error('mode 必须为 speed 或 balanced');
  const mode = values.mode as TranslationMode;
  if (!values.out) throw new Error('缺少 --out');
  const directory = path.resolve(values.out);
  if (!path.relative(PROJECT_ROOT, directory).replaceAll('\\', '/').startsWith('.eval/'))
    throw new Error('模型响应必须保存到项目的 .eval/ 下');
  const dataset = path.resolve(values.dataset);
  const indexText = await readFile(path.join(dataset, 'index.json'), 'utf8');
  const index = JSON.parse(indexText) as { cases: DatasetEntry[] };
  const selected = index.cases.filter(
    (entry) =>
      values.group === 'all' ||
      (values.group === 'smoke' && entry.smoke) ||
      (values.group === 'diagnostic' && entry.tier === 'diagnostic') ||
      (entry.tier === 'primary' && entry.split === values.group),
  );
  if (!selected.length) throw new Error('没有选中片段');
  const inputs = new Map<string, Input>();
  for (const entry of selected) {
    const text = await readFile(path.join(dataset, entry.input), 'utf8');
    if (hash(text) !== entry.sha256) throw new Error(`输入指纹不匹配：${entry.id}`);
    const input = JSON.parse(text) as Input;
    if (!input.tokens.length || !input.scoreTokenIds.length) throw new Error('空输入');
    // Whitelist model context. Evaluation annotations and reference files are never read.
    const { videoTitle, channelName, transcriptEvidence } = input.context;
    input.context = {
      ...(videoTitle ? { videoTitle } : {}),
      ...(channelName ? { channelName } : {}),
      ...(transcriptEvidence ? { transcriptEvidence } : {}),
      correctionEnabled: true,
      terminology: [],
      entityAliases: [],
      previousCues: [],
    };
    inputs.set(entry.id, input);
  }
  const protocol = values.protocol ?? DEFAULT_PROVIDER_SETTINGS.protocol;
  if (!['auto', 'chat-completions', 'responses'].includes(protocol)) throw new Error('无效协议');
  const limit = Number(values['max-requests']);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('请求预算必须为正整数');
  const settings: ProviderSettings = {
    ...DEFAULT_PROVIDER_SETTINGS,
    model: values.model ?? DEFAULT_PROVIDER_SETTINGS.model,
    baseUrl: (values['base-url'] ?? DEFAULT_PROVIDER_SETTINGS.baseUrl).replace(/\/+$/u, ''),
    protocol: protocol as ProviderSettings['protocol'],
  };
  const identity = {
    mode,
    policyVersion: TRANSLATION_POLICY_VERSION,
    model: settings.model,
    baseUrl: settings.baseUrl,
    protocol: settings.protocol,
    pipelineHash: await pipelineHash(),
    runnerHash: hash(await readFile(new URL(import.meta.url), 'utf8')),
    datasetHash: hash(indexText),
    selected: selected.map(({ id, sha256 }) => ({ id, sha256 })),
    entrypoint: 'PlaybackPlan + translatePlaybackWindow',
    contextPolicy:
      'fixed local source evidence; empty per-case initial glossary; within-case accepted history and discovered terms; no full-video entity resolution',
    scheduling: 'sequential cases and windows; no playback/cache simulation',
    referenceAccess: 'none',
  };
  const fingerprint = hash(identity);
  console.log(
    `${settings.model} / ${settings.protocol}: ${selected.length} cases; request limit ${limit}`,
  );
  if (values['dry-run']) {
    console.log('Validated input fingerprints; no key read, output directory or model calls.');
    return;
  }
  secret = values['token-file']
    ? (await readFile(values['token-file'], 'utf8')).trim()
    : (process.env.CUEWEAVE_LLM_TOKEN ?? '').trim();
  if (!secret) throw new Error('缺少模型密钥');
  settings.apiKey = secret;
  if (!values.resume) {
    await mkdir(path.dirname(directory), { recursive: true });
    await mkdir(directory);
    await mkdir(path.join(directory, 'requests'));
    await mkdir(path.join(directory, 'inputs'));
    await cp(path.join(PROJECT_ROOT, 'packages/core/src'), path.join(directory, 'source/core'), {
      recursive: true,
    });
    await copyFile(new URL(import.meta.url), path.join(directory, 'source/runner.ts'));
    for (const entry of selected)
      await copyFile(
        path.join(dataset, entry.input),
        path.join(directory, 'inputs', `${entry.id}.json`),
      );
  }
  const unlock = await acquireLock(directory);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const budget: RequestBudget = { used: 0, limit, exhausted: false };
  let run: Run;
  try {
    run = values.resume
      ? (JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8')) as Run)
      : { schema: 1, fingerprint, identity, selected, results: {}, status: 'running' };
    if (run.fingerprint !== fingerprint) throw new Error('输入、参数或源码变化，不能续跑');
    const save = () => writeJson(path.join(directory, 'result.json'), run, secret);
    run.status = 'running';
    await save();
    for (const entry of selected) {
      if (controller.signal.aborted || budget.exhausted) break;
      if (run.results[entry.id]?.at(-1)?.status === 'success') continue;
      const input = inputs.get(entry.id)!;
      const plan = new PlaybackPlan(input.tokens, undefined, mode);
      const started = performance.now();
      const result: CaseResult = {
        status: 'running',
        startedAt: new Date().toISOString(),
        durationMs: 0,
        inputSha256: entry.sha256,
        attempts: [],
        plan: plan.snapshot(),
        planningFallbacks: [],
        cues: [],
        missingScoreTokens: [...input.scoreTokenIds],
        missingInputTokens: input.tokens.map((t) => t.id),
        duplicatedInputTokens: [],
        unexpectedInputTokens: [],
      };
      (run.results[entry.id] ??= []).push(result);
      await save();
      const terms = new Map<string, TranslationTerm>();
      console.log(`START ${entry.id}`);
      try {
        for (let w = 0; w < plan.snapshot().ends.length; w++) {
          if (controller.signal.aborted) throw new Error('已暂停');
          const attempt: Attempt = {
            id: randomUUID(),
            contextHash: '',
            status: 'running',
            startedAt: new Date().toISOString(),
            durationMs: 0,
            stages: [],
            diagnostics: [],
            requests: [],
            cues: [],
          };
          result.attempts.push(attempt);
          await save();
          const runtime = createRuntime(
            directory,
            attempt,
            `${entry.id}:window-${w}`,
            secret,
            budget,
          );
          const trackedFetch = runtime.fetch!;
          runtime.fetch = async (...args) => {
            if (budget.used >= budget.limit) {
              budget.exhausted = true;
              controller.abort();
              throw new Error('已达到请求预算');
            }
            return trackedFetch(...args);
          };
          runtime.onDiagnostic = (event) => {
            attempt.diagnostics.push(event);
            if (event.kind === 'stage') attempt.stages.push(event.message);
          };
          const windowStart = performance.now();
          try {
            const window = await plan.prepare(
              w,
              createSubtitleJsonRequest(settings, controller.signal, undefined, runtime, mode),
              controller.signal,
              async (snapshot) => {
                result.plan = snapshot;
                await save();
              },
              (message) => result.planningFallbacks.push(message),
            );
            const context: AiSubtitleContext = {
              ...input.context,
              translationMode: mode,
              terminology: [...terms.values()].slice(-80),
              previousCues: result.cues
                .filter((cue) => cue.endMs < window.startMs)
                .slice(-6)
                .map(({ sourceText, translation }) => ({ sourceText, translation })),
            };
            attempt.contextHash = hash(context);
            attempt.cues = await translatePlaybackWindow(
              settings,
              window.tokens,
              undefined,
              controller.signal,
              context,
              sourceNeighbors(input.tokens, window.tokens),
              runtime,
            );
            result.cues.push(...attempt.cues);
            if (attempt.cues.length && result.firstUsableMs === undefined)
              result.firstUsableMs = Math.round(performance.now() - started);
            for (const cue of attempt.cues)
              for (const term of cue.terminology ?? [])
                terms.set(term.source.toLocaleLowerCase(), term);
            attempt.status = 'success';
          } catch (error) {
            if (error instanceof PartialTranslationError) {
              attempt.cues = error.cues;
              result.cues.push(...error.cues);
              if (error.cues.length && result.firstUsableMs === undefined)
                result.firstUsableMs = Math.round(performance.now() - started);
            }
            attempt.status = 'failed';
            attempt.error = error instanceof Error ? error.message : String(error);
            if (
              controller.signal.aborted ||
              attempt.requests.some(
                (r) => r.status === null || [401, 403, 404, 429].includes(r.status),
              )
            )
              controller.abort();
          } finally {
            attempt.durationMs = Math.round(performance.now() - windowStart);
            await save();
          }
          if (controller.signal.aborted) break;
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
      } finally {
        result.durationMs = Math.round(performance.now() - started);
        const counts = new Map<string, number>();
        for (const cue of result.cues)
          for (const id of cue.sourceTokenIds) counts.set(id, (counts.get(id) ?? 0) + 1);
        const expected = new Set(input.tokens.map((t) => t.id));
        result.missingScoreTokens = input.scoreTokenIds.filter((id) => !counts.has(id));
        result.missingInputTokens = [...expected].filter((id) => !counts.has(id));
        result.duplicatedInputTokens = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
        result.unexpectedInputTokens = [...counts.keys()].filter((id) => !expected.has(id));
        result.status =
          result.missingInputTokens.length ||
          result.duplicatedInputTokens.length ||
          result.unexpectedInputTokens.length
            ? result.cues.length
              ? 'partial'
              : 'failed'
            : 'success';
        await save();
        console.log(
          `${result.status.toUpperCase()} ${entry.id}: ${result.cues.length} cues; ${result.missingScoreTokens.length} missing scored tokens; ${result.durationMs}ms`,
        );
      }
    }
    run.status =
      controller.signal.aborted || budget.exhausted
        ? 'paused'
        : selected.every((entry) => run.results[entry.id]?.at(-1)?.status === 'success')
          ? 'completed'
          : 'completed-with-errors';
    await save();
    const traces = await Promise.all(
      (await readdir(path.join(directory, 'requests')))
        .filter((name) => name.endsWith('.json'))
        .map(
          async (name) =>
            JSON.parse(await readFile(path.join(directory, 'requests', name), 'utf8')) as {
              usage?: { input: number; output: number; total: number } | null;
              status: number | null;
              durationMs: number;
            },
        ),
    );
    await writeJson(
      path.join(directory, 'summary.json'),
      {
        status: run.status,
        cases: selected.length,
        completedCases: selected.filter(
          (entry) => run.results[entry.id]?.at(-1)?.status === 'success',
        ).length,
        requestCount: traces.length,
        thisInvocationRequests: budget.used,
        missingUsageRequests: traces.filter((r) => !r.usage).length,
        reportedUsage: traces.reduce(
          (sum, r) => ({
            input: sum.input + (r.usage?.input ?? 0),
            output: sum.output + (r.usage?.output ?? 0),
            total: sum.total + (r.usage?.total ?? 0),
          }),
          { input: 0, output: 0, total: 0 },
        ),
        note: 'Offline sequential production-core baseline, not player latency; no semantic scoring or reference access in this runner.',
      },
      secret,
    );
    console.log(run.status);
    if (run.status !== 'completed') process.exitCode = 2;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await unlock();
  }
}

main().catch((error: unknown) => {
  console.error(redact(error instanceof Error ? error.message : String(error), secret));
  process.exitCode = 1;
});
