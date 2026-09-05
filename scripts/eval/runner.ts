import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildSourceTokens,
  createTokenWindows,
  extractTranscriptEntityCandidates,
  extractTranscriptEvidenceTerms,
  ENTITY_ALIAS_PROMPT_VERSION,
} from '@cueweave/core/subtitle';
import type { TranslationTerm } from '@cueweave/core/subtitle';
import { AI_PROMPT_VERSION, DISPLAY_SEGMENTATION_VERSION } from '@cueweave/core/subtitle/ai';
import type { AiSubtitleContext } from '@cueweave/core/subtitle/ai';
import { parseJson3Captions } from '../../apps/extension/src/platform/youtube/captions';
import {
  resolveVideoEntityAliases,
  translateTokenWindow,
} from '@cueweave/core/provider/chatCompletions';
import type { ProviderSettings } from '@cueweave/core/provider/types';
import { ProviderError } from '@cueweave/core/provider/types';
import { acquireLock, hash, pipelineHash, PROJECT_ROOT, readRun, writeJson } from './io';
import { createRuntime } from './trace';
import type { RequestBudget } from './trace';
import { currentAttempt } from './types';
import type { Attempt, EvalCase, EvalIdentity, EvalRun } from './types';

export interface RunOptions {
  input: string;
  directory: string;
  settings: ProviderSettings;
  mode: EvalIdentity['mode'];
  context: AiSubtitleContext;
  cases: EvalCase[];
  fromMs: number;
  toMs: number;
  limit: number;
  maxRequests: number;
  resume: boolean;
  dryRun: boolean;
  fetcher?: typeof fetch;
}

function newAttempt(contextHash: string): Attempt {
  return {
    id: randomUUID(),
    contextHash,
    status: 'running',
    startedAt: new Date().toISOString(),
    durationMs: 0,
    stages: [],
    diagnostics: [],
    requests: [],
    cues: [],
  };
}

export function mergeTerms(
  ...groups: ReadonlyArray<readonly TranslationTerm[]>
): TranslationTerm[] {
  const merged = new Map<string, TranslationTerm>();
  for (const terms of groups)
    for (const term of terms) merged.set(term.source.toLocaleLowerCase(), term);
  return [...merged.values()].slice(-80);
}

export function contextForWindow(run: EvalRun, index: number): AiSubtitleContext {
  const base = run.identity.context;
  const evidence = extractTranscriptEvidenceTerms(run.tokens);
  if (run.identity.mode === 'translation') {
    return { ...base, transcriptEvidence: evidence, previousCues: [] };
  }
  const earlierCues = run.windows.slice(0, index).flatMap((window) => {
    const attempt = currentAttempt(run, window.id);
    return attempt?.status === 'success' ? attempt.cues : [];
  });
  return {
    ...base,
    transcriptEvidence: evidence,
    entityAliases: run.aliases ?? [],
    terminology: mergeTerms(
      earlierCues.flatMap((cue) => cue.terminology ?? []),
      run.aliases ?? [],
      base.terminology ?? [],
    ),
    previousCues: earlierCues
      .slice(-6)
      .map((cue) => ({ sourceText: cue.sourceText, translation: cue.translation })),
  };
}

export function canReuse(attempt: Attempt | undefined, contextHash: string): boolean {
  return attempt?.status === 'success' && attempt.contextHash === contextHash;
}

export async function runEvaluation(options: RunOptions): Promise<EvalRun | undefined> {
  const raw = await readFile(options.input, 'utf8');
  const fixture = JSON.parse(raw) as {
    videoId?: string;
    languageCode?: string;
  } & Parameters<typeof parseJson3Captions>[0];
  if (!Array.isArray(fixture.events) || !fixture.videoId || !fixture.languageCode) {
    throw new Error(
      '字幕输入必须包含 videoId、languageCode 和 JSON3 events；请使用 fixture:youtube 保存的完整字幕。',
    );
  }
  const tokens = buildSourceTokens(parseJson3Captions(fixture));
  const windows = createTokenWindows(tokens)
    .filter((window) => window.endMs >= options.fromMs && window.startMs < options.toMs)
    .slice(0, options.limit);
  if (windows.length === 0) throw new Error('所选时间范围没有字幕窗口。请检查 --from 和 --to。');
  if (
    options.mode === 'translation' &&
    (!options.context.entityAliases || !options.context.terminology)
  ) {
    throw new Error(
      'translation 模式需要 --context 文件明确提供 entityAliases 和 terminology 数组（允许空数组）。',
    );
  }
  const { baseUrl, model, protocol } = options.settings;
  const identity: EvalIdentity = {
    baseUrl,
    model,
    protocol,
    inputHash: hash(raw),
    pipelineHash: await pipelineHash(),
    mode: options.mode,
    context: options.context,
    windowIds: windows.map((window) => window.id),
    promptVersion: AI_PROMPT_VERSION,
    segmentationVersion: DISPLAY_SEGMENTATION_VERSION,
    entityVersion: ENTITY_ALIAS_PROMPT_VERSION,
  };
  console.info(
    `视频 ${fixture.videoId} · ${options.settings.model} · ${options.mode} · ${windows.length} 个窗口 · 本次最多 ${options.maxRequests} 次请求`,
  );
  if (options.dryRun) {
    console.info('仅检查输入与运行范围，未请求模型、未写入运行目录。');
    return undefined;
  }
  let run: EvalRun;
  const fingerprint = hash(identity);
  if (options.resume) {
    run = await readRun(options.directory);
    if (run.fingerprint !== fingerprint)
      throw new Error(
        '续跑输入不一致：字幕、源码、模型、模式或上下文已改变。请恢复原配置，或指定新的 --run 目录。',
      );
  } else {
    await mkdir(path.dirname(options.directory), { recursive: true });
    await mkdir(options.directory);
    let gitRevision = 'unavailable';
    try {
      gitRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
      }).trim();
    } catch {
      /* The source fingerprint still identifies uncommitted builds. */
    }
    run = {
      schema: 1,
      id: randomUUID(),
      name: path.basename(options.directory),
      videoId: fixture.videoId,
      languageCode: fixture.languageCode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      fingerprint,
      identity,
      gitRevision,
      tokens,
      windows,
      results: {},
      entityAttempts: [],
      aliases: null,
      cases: options.cases,
    };
    await writeJson(path.join(options.directory, 'input.json'), fixture);
  }
  const unlock = await acquireLock(options.directory);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const budget: RequestBudget = { used: 0, limit: options.maxRequests, exhausted: false };
  const checkpoint = async () => {
    run.updatedAt = new Date().toISOString();
    await writeJson(path.join(options.directory, 'result.json'), run, options.settings.apiKey);
  };
  try {
    await mkdir(path.join(options.directory, 'requests'), { recursive: true });
    for (const attempt of [...run.entityAttempts, ...Object.values(run.results).flat()]) {
      if (attempt.status === 'running') attempt.status = 'interrupted';
    }
    run.status = 'running';
    await checkpoint();
    if (
      options.mode === 'translation' ||
      options.context.correctionEnabled === false ||
      options.context.entityAliases
    ) {
      run.aliases = [...(options.context.entityAliases ?? [])];
    } else if (run.aliases === null) {
      const attempt = newAttempt(hash(options.context));
      run.entityAttempts.push(attempt);
      await checkpoint();
      const started = performance.now();
      console.info('识别视频级实体别名…');
      try {
        run.aliases = await resolveVideoEntityAliases(
          options.settings,
          extractTranscriptEntityCandidates(tokens),
          options.context,
          controller.signal,
          createRuntime(
            options.directory,
            attempt,
            'entities',
            options.settings.apiKey,
            budget,
            options.fetcher,
          ),
        );
        attempt.status = 'success';
      } catch (error) {
        attempt.status = controller.signal.aborted || budget.exhausted ? 'interrupted' : 'failed';
        attempt.error = error instanceof Error ? error.message : String(error);
        if (
          error instanceof ProviderError &&
          [
            'authentication',
            'model-not-found',
            'rate-limited',
            'network',
            'not-configured',
          ].includes(error.code)
        )
          run.status = 'paused';
        console.warn(`实体识别未完成，保留原始写法：${attempt.error}`);
      }
      attempt.durationMs = Math.round(performance.now() - started);
      await checkpoint();
    }

    for (const [index, window] of windows.entries()) {
      const context = contextForWindow(run, index);
      const contextHash = hash(context);
      if (canReuse(currentAttempt(run, window.id), contextHash)) {
        console.info(`[${index + 1}/${windows.length}] 复用已完成窗口`);
        continue;
      }
      if (
        controller.signal.aborted ||
        budget.exhausted ||
        budget.used >= budget.limit ||
        run.status === 'paused'
      ) {
        run.status = 'paused';
        break;
      }
      const attempt = newAttempt(contextHash);
      (run.results[window.id] ??= []).push(attempt);
      await checkpoint();
      const started = performance.now();
      try {
        attempt.cues = await translateTokenWindow(
          options.settings,
          window.tokens,
          (stage) => attempt.stages.push(stage),
          controller.signal,
          context,
          createRuntime(
            options.directory,
            attempt,
            window.id,
            options.settings.apiKey,
            budget,
            options.fetcher,
          ),
        );
        attempt.status = 'success';
      } catch (error) {
        attempt.status = controller.signal.aborted || budget.exhausted ? 'interrupted' : 'failed';
        attempt.error = error instanceof Error ? error.message : String(error);
        if (
          error instanceof ProviderError &&
          [
            'authentication',
            'model-not-found',
            'rate-limited',
            'network',
            'not-configured',
          ].includes(error.code)
        )
          run.status = 'paused';
      }
      attempt.durationMs = Math.round(performance.now() - started);
      await checkpoint();
      console.info(
        `[${index + 1}/${windows.length}] ${Math.floor(window.startMs / 1000)}s · ${attempt.status} · ${attempt.requests.length} 次请求 · ${attempt.durationMs}ms${attempt.error ? ` · ${attempt.error}` : ''}`,
      );
    }
    if (controller.signal.aborted || budget.exhausted || run.status === 'paused')
      run.status = 'paused';
    else
      run.status = windows.every((window) => currentAttempt(run, window.id)?.status === 'success')
        ? 'completed'
        : 'completed-with-errors';
    await checkpoint();
    return run;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    await unlock();
  }
}
